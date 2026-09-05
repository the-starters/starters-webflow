
  var profileFormControllers = window.__tsProfileFormControllers || (window.__tsProfileFormControllers = {});
  if (!profileFormControllers.buildProfileSubmitWriter) {
  profileFormControllers.buildProfileSubmitWriter = true;
  document.addEventListener('DOMContentLoaded', function () {
    waitForMember(() => {
      if (!MEMBER.id) return;

      const form = qs('[build-profile-form]');
      const success = qs('[build-profile-success]');
      const error = qs('[build-profile-error]');
      const formSubmit = form ? qs('[form-submit]', form) : null;
      if (!form || !formSubmit || !success || !error) return;

      [
        { selector: '[name="rate"]', min: 1, max: 1000 },
        { selector: '[name="rate-retainer"]', min: 1, max: 25000 },
        { selector: '[name="paid-call-rate"]', min: 1, max: 1000 },
      ].forEach(({ selector, min, max }) => {
        const input = qs(selector, form);
        if (!input) return;
        input.setAttribute('type', 'number');
        input.setAttribute('inputmode', 'numeric');
        input.setAttribute('step', '1');
        input.setAttribute('min', String(min));
        input.setAttribute('max', String(max));
      });

      success.style.display = 'none';
      error.style.display = 'none';
      let savedBuildResult = null;

      // Service prices and names live in hidden JSON capture inputs, so a failure
      // reported through one paints nothing: no focus, no native bubble. Those
      // failures own the authored error panel's own message instead, the same way
      // the Edit Profile step routes its mirrored service prices to the authored
      // modal, so a blocked submit always says which price stopped it.
      // Only an explicit hook, or a leaf the panel authored as its copy, may be
      // written through. Anything holding markup of its own — an icon beside the
      // text, a wrapper — is left alone: the panel is revealed exactly as authored
      // rather than flattened into a single text node for the rest of the session.
      const errorMessageHook = qs('[build-profile-error-message]', error);
      const errorMessageLeaf = errorMessageHook || qs('p, div', error);
      const errorMessage = errorMessageHook
        || (errorMessageLeaf && !errorMessageLeaf.querySelector?.('*') ? errorMessageLeaf : null);
      const authoredErrorMessage = errorMessage ? errorMessage.textContent : '';
      const PRICE_CONTROL_SELECTORS = [
        '[name="rate"]', '[name="rate-retainer"]', '[name="paid-call-rate"]',
        '#service', '#service-2', '#service-3',
      ];

      function paintErrorMessage(message) {
        if (errorMessage) errorMessage.textContent = message || authoredErrorMessage;
      }

      function resetSubmitFeedback() {
        paintErrorMessage(null);
        PRICE_CONTROL_SELECTORS.forEach((selector) => qs(selector, form)?.setCustomValidity?.(''));
      }

      // custom form submission handler
      formSubmit.addEventListener('click', async function (e) {
        e.preventDefault();
        resetSubmitFeedback();

        const data = Object.fromEntries(new FormData(form));

        // country/state
        const countrySelect = qs('#country');
        if (countrySelect) data.country = countrySelect.options[countrySelect.selectedIndex]?.text || '';
        const stateSelect = qs('#state');
        if (stateSelect) data.state = stateSelect.options[stateSelect.selectedIndex]?.text || '';

        // type
        data.type = activeProfile.type || '';
        data.type_id = activeProfile.type_id || '';

        console.log("Form Data:", data);

        try {
          const result = await submitFreelancerData(data);
          console.log("Normalized Data:", result);
        } catch (submitError) {
          setLoader(false, formSubmit.closest('[data-form="step"]'));
          paintErrorMessage(submitError?.panelMessage);
          success.style.display = 'none';
          error.style.display = 'block';
          console.error('[build-profile] submit failed', submitError?.code || 'SUBMIT_FAILED');
        }
      });

      async function submitFreelancerData(formData) {
        const ENDPOINT_URL = "https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/build_profile/starter/update";

        const toBool = (value) => {
          if (value === "yes") return true;
          if (value === "no") return false;
          return value;
        };

        const priceError = (field, message, code, mirror) => {
          if (mirror || !field) {
            throw Object.assign(new Error(message), { code, panelMessage: message });
          }
          field.setCustomValidity?.(message);
          field.focus?.();
          field.reportValidity?.();
          throw Object.assign(new Error(message), { code });
        };

        // Wherever a blank is the compatibility-empty state, the canonical zero this
        // same writer persists for that field is that same state rather than an
        // authored price. Otherwise a rate the writer stored itself blocks its own
        // next submit on a control the member cannot repair.
        const compatibilityEmpty = (raw, allowBlank) => Boolean(allowBlank) && (raw === '' || /^0+$/.test(raw));

        const wholeDollarFailure = (value, { min, max, allowBlank = false }) => {
          const raw = String(value ?? '').trim();
          if (compatibilityEmpty(raw, allowBlank)) return null;
          if (!raw) return 'PRICE_REQUIRED';
          if (!/^[0-9]+$/.test(raw)) return 'PRICE_NOT_INTEGER';
          const number = Number(raw);
          if (!Number.isSafeInteger(number)) return 'PRICE_NOT_INTEGER';
          if (number < min || number > max) return 'PRICE_OUT_OF_RANGE';
          return null;
        };

        const wholeDollar = (value, contract) => {
          const { min, max, label, selector, mirror } = contract;
          const field = qs(selector, form);
          const failure = wholeDollarFailure(value, contract);
          if (failure) {
            const message = failure === 'PRICE_REQUIRED'
              ? `${label} is required.`
              : `Use a whole-dollar ${label} from $${min.toLocaleString('en-US')} to $${max.toLocaleString('en-US')}.`;
            return priceError(field, message, failure, mirror);
          }
          field?.setCustomValidity?.('');
          const raw = String(value ?? '').trim();
          return compatibilityEmpty(raw, contract.allowBlank) ? null : Number(raw);
        };

        const parseJson = (value) => {
          if (!value || typeof value !== "string") return null;

          try {
            return JSON.parse(value);
          } catch (error) {
            console.warn("Invalid JSON field:", value);
            return null;
          }
        };

        const normalizeReviewer = (reviewer) => {
          if (!reviewer) return null;

          const firstName = reviewer.fname || reviewer["first-name"] || "";
          const lastName = reviewer.lname || reviewer["last-name"] || "";
          const position = reviewer.job || reviewer.position || "";
          if (!firstName || !reviewer.email) return null;

          return {
            "first-name": firstName,
            "last-name": lastName,
            position,
            company: reviewer.company || "",
            email: reviewer.email || "",
          };
        };

        // Clearing the price is the only remove gesture these forms author, so an
        // empty price empties the slot instead of blocking the submit on a service
        // the member is deleting. A non-blank price is authored and stays strict.
        function requiredServicesFields(data, selector) {
          if (!data || data.price == null) return null;
          // Validate JSON type before blank detection or numeric conversion:
          // [] is not a remove gesture and [100] is not a scalar price.
          if (typeof data.price !== 'string' && typeof data.price !== 'number') {
            return priceError(qs(selector, form), 'Use a whole-dollar service price from $1 to $50,000.', 'PRICE_NOT_INTEGER', true);
          }
          if (typeof data.price === 'string' && !data.price.trim()) return null;
          if (!String(data.name ?? '').trim()) {
            return priceError(qs(selector, form), 'A service name is required when a service price is set.', 'SERVICE_NAME_REQUIRED', true);
          }
          data.price = wholeDollar(data.price, {
            min: 1,
            max: 50000,
            label: 'service price',
            selector,
            mirror: true,
          });
          return data;
        }

        const services = {
          "service-1": requiredServicesFields(parseJson(formData.service), '#service'),
          "service-2": requiredServicesFields(parseJson(formData["service-2"]), '#service-2'),
          "service-3": requiredServicesFields(parseJson(formData["service-3"]), '#service-3'),
        };

        const reviewers = {
          "reviewer-1": normalizeReviewer(parseJson(formData.reviewer)),
          "reviewer-2": normalizeReviewer(parseJson(formData["reviewer-2"])),
          "reviewer-3": normalizeReviewer(parseJson(formData["reviewer-3"])),
        };

        const isConsultProfile = String(window.location?.pathname || "").replace(/\/+$/, "") === "/build-profile/consult";
        const PAID_CALL_PRICE = {
          min: 1,
          max: 1000,
          label: 'paid call rate',
          selector: '[name="paid-call-rate"]',
        };
        const paidCallSelected = toBool(formData["paid-consulting-calls"]) === true;
        // A toggle-owned rate is only authored while its own section says yes. Once the
        // toggle is off the control is collapsed, so its stale text is neither visible
        // nor editable and must never block the whole submit behind a price failure the
        // member cannot see or reach. The consult flow authors no paid-call section at
        // all, so neither the hidden radio nor its hidden text is an authored answer
        // there: only a rate the contract already accepts preserves a paid consult, and
        // every other value, blank included, keeps the no-paid-consult compatibility
        // state. Full Profile authors the control, so its answer stays strict.
        const paidCallInContract = wholeDollarFailure(formData["paid-call-rate"], PAID_CALL_PRICE) === null;
        const paidCallEnabled = isConsultProfile ? paidCallInContract : paidCallSelected;
        const paidCallRate = paidCallEnabled
          ? wholeDollar(formData["paid-call-rate"], PAID_CALL_PRICE)
          : null;

        const fullProfile = !isConsultProfile;
        const HOURLY_PRICE = {
          min: 1,
          max: 1000,
          label: 'hourly rate',
          selector: '[name="rate"]',
          allowBlank: !fullProfile,
        };
        const hourlyInContract = wholeDollarFailure(formData.rate, HOURLY_PRICE) === null;
        const hourlyRate = fullProfile || hourlyInContract
          ? wholeDollar(formData.rate, HOURLY_PRICE)
          : null;
        const RETAINER_PRICE = {
          min: 1,
          max: 25000,
          label: 'monthly retainer rate',
          selector: '[name="rate-retainer"]',
        };
        const retainerSelected = toBool(formData["offer-monthly-retainers"]) === true;
        // Consult does not author the retainer section. Hidden hydrated controls
        // must never enable or block a value the member cannot repair here.
        const retainerEnabled = isConsultProfile ? false : retainerSelected;
        const retainerRate = retainerEnabled
          ? wholeDollar(formData["rate-retainer"], RETAINER_PRICE)
          : 0;

        const payload = {
          member_id: MEMBER.id || "",

          type: formData.type || "",
          type_id: formData.type_id || "",

          email: formData.email || "",
          first_name: formData["first-name"] || "",
          last_name: formData["last-name"] || "",
          phone: window.intlTelInput?.getInstance(qs('input[name="phone"]'))?.getNumber() || formData.phone || "",

          country: formData.country || "",
          state: formData.state || "",
          city: formData.city || "",

          category: formData["function-option"] || "",
          category_id: formData.function || "",

          roles: formData["role-option"] || "",
          roles_ids: formData.roles || "",

          skills: formData["skill-option"] || "",
          skills_ids: formData.skills || "",

          tools: formData["tool-option"] || "",
          tools_ids: formData.tools || "",

          industries: formData["industries-option"] || "",
          industries_ids: formData.industries || "",

          subcategories: formData["subcategories-option"] || "",
          subcategories_ids: formData.subcategories || "",

          tagline: formData.tagline || "",
          pro_headline: formData["pro-headline"] || "",
          bio: formData["bio-html"] || "",

          best_fit_1: formData["best-fit-1"] || "",
          best_fit_2: formData["best-fit-2"] || "",
          best_fit_3: formData["best-fit-3"] || "",

          hourly_rate: hourlyRate === null ? 0 : hourlyRate,

          availability: formData["availability-option"] || "",
          availability_id: formData.availability || "",

          full_time: toBool(formData["full-time-placement"]),

          free_call: toBool(formData["free-consulting-calls"]),
          free_call_desc: formData["free-call-description"] || "",

          // The authored paid-call control is hidden in the consult flow, so an
          // in-contract whole-dollar rate is the only enablement signal there,
          // whichever way fallback hydration left the hidden radio.
          paid_call: paidCallEnabled,
          paid_call_desc: formData["paid-call-description"] || "",
          paid_call_rate: paidCallRate,

          retainer: retainerEnabled,
          retainer_desc: formData["description-retainer"] || "",
          retainer_rate: retainerRate,

          services,
          reviewers,

          also_worked_with: parseJson(formData["also-worked-with"]),

          updated: Date.now(),
        };

        // `updated` changes on every click. Compare the actual authored payload so an
        // unchanged photo retry can reuse the completed profile save, while a user edit
        // after a failed photo commit forces a fresh canonical save.
        const payloadFingerprint = JSON.stringify({ ...payload, updated: 0 });
        if (savedBuildResult && savedBuildResult.payloadFingerprint !== payloadFingerprint) {
          savedBuildResult = null;
        }

        //if (localStorage.getItem('submit_profile')) {
          const step = formSubmit.closest('[data-form="step"]');
          setLoader(true, step);

          if (!savedBuildResult) {
            const response = await xanoAuthFetch(ENDPOINT_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`Xano request failed: ${response.status} ${errorText}`);
            }

            savedBuildResult = {
              payload,
              payloadFingerprint,
              responseData: await response.json(),
            };
          }

          const committedPayload = savedBuildResult.payload;
          const photoUpload = window.StartersBuildProfilePhotoUpload;
          if (photoUpload?.hasPendingUpload?.()) {
            photoUpload.markProfileSaved();
            await photoUpload.commitPending();
          }

          // update Member customFields, if even one of them was changed
          if (
            MEMBER.customFields?.['free-user']?.toLowerCase().trim() !== (committedPayload['first_name'] || '').toLowerCase().trim() ||
            MEMBER.customFields?.['last-name']?.toLowerCase().trim() !== (committedPayload['last_name'] || '').toLowerCase().trim() ||
            MEMBER.customFields?.['phone']?.toLowerCase().trim() !== (committedPayload['phone'] || '').toLowerCase().trim()
          ) {
            try {
              await window.$memberstackDom.updateMember({
                customFields: {
                  'free-user': committedPayload.first_name || '',
                  'last-name': committedPayload.last_name || '',
                  'phone': committedPayload.phone || '',
                }
              });
            } catch (error) {
              console.error("Failed to update Member customFields:", error);
            }
          }

          // update email, if it was changed
          if (MEMBER.auth.email?.trim() !== committedPayload.email?.trim()) {
            try {
              await window.$memberstackDom.updateMemberAuth({
                email: committedPayload.email,
              });
            } catch (error) {
              console.error("Failed to update Member email:", error);
            }
          }

          const successName = qs('[data-value="first-name"]', success);
          if (successName) successName.textContent = committedPayload.first_name || '';

          const successCTA = qs('[dashboard-button-wrap] .button', success);
          if (successCTA) {
            const redirectUrl = MEMBER.customFields?.['freelancer-dashboard-url'] || MEMBER.customFields?.['freelancer-profile-url'] || '/starter-dashboard';
            successCTA.href = redirectUrl;
          }

          setLoader(false, step);
          form.style.display = 'none';
          error.style.display = 'none';
          success.style.display = 'block';

          console.log("payload:", committedPayload);

          return savedBuildResult.responseData;
        // } else {

        //   // update Member customFields, if even one of them was changed
        //   if (
        //     MEMBER.customFields?.['free-user']?.toLowerCase().trim() !== (payload['first_name'] || '').toLowerCase().trim() ||
        //     MEMBER.customFields?.['last-name']?.toLowerCase().trim() !== (payload['last_name'] || '').toLowerCase().trim() ||
        //     MEMBER.customFields?.['phone']?.toLowerCase().trim() !== (payload['phone'] || '').toLowerCase().trim()
        //   ) {
        //     console.log("Updating Member customFields");
        //   }

        //   // update email, if it was changed
        //   if (MEMBER.auth.email?.trim() !== payload.email?.trim()) {
        //     console.log("Updating Member Email");
        //   }

        //   return payload; // For testing purposes, return the payload instead of making the request
        // }
      }
    });
  });
  }
