
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
      const priceFeedback = new Map();

      // Build Profile can collect call preferences before a new Starter has the
      // calendar, availability, and (for Paid) Stripe prerequisites required by
      // the provider-backed Call Settings writers. Keep that pre-activation
      // intent in the member's private JSON. Dashboard/Edit Profile consume it
      // as create, update, or disable intent; the canonical endpoints remain
      // the only writers of provider state and freelancers_v3 call projections.
      const BUILD_CALL_INTENT_KEY = 'starter_call_settings_intent_v3';

      function queueMemberJsonWrite(task) {
        const previous = window.__tsMemberJsonWrite || Promise.resolve();
        const next = previous.then(task, task);
        window.__tsMemberJsonWrite = next.then(function () {}, function () {});
        return next;
      }

      function buildCallSettingsIntent(formData) {
        const hasFree = Object.prototype.hasOwnProperty.call(formData, 'free-consulting-calls');
        const hasPaid = Object.prototype.hasOwnProperty.call(formData, 'paid-consulting-calls');
        if (!hasFree && !hasPaid) return null;

        const enabled = (value) => value === 'yes';
        const intent = {
          version: 1,
          member_id: MEMBER.id,
          source: 'build-profile',
          updated_at: Date.now(),
        };

        if (hasFree) {
          const freeEnabled = enabled(formData['free-consulting-calls']);
          const description = freeEnabled ? String(formData['free-call-description'] || '').trim() : '';
          if (freeEnabled && description.length > 60) {
            throw Object.assign(new Error('Free-call description must be 60 characters or fewer.'), {
              code: 'FREE_CALL_DESCRIPTION_TOO_LONG',
              panelMessage: 'Free-call description must be 60 characters or fewer.',
            });
          }
          intent.free = {
            enabled: freeEnabled,
            description,
          };
        }

        if (hasPaid) {
          const paidEnabled = enabled(formData['paid-consulting-calls']);
          const title = String(formData['paid-call-description'] || '').trim() || 'Paid Consultation Call';
          const rawRate = String(formData['paid-call-rate'] || '').trim();
          if (paidEnabled && (title.length < 3 || title.length > 80)) {
            throw Object.assign(new Error('Use a paid-call title between 3 and 80 characters.'), {
              code: 'PAID_CALL_TITLE_INVALID',
              panelMessage: 'Use a paid-call title between 3 and 80 characters.',
            });
          }
          if (paidEnabled && (!/^[0-9]+$/.test(rawRate) || Number(rawRate) < 1 || Number(rawRate) > 1000)) {
            throw Object.assign(new Error('Use a whole-dollar paid-call rate from $1 to $1,000.'), {
              code: 'PAID_CALL_RATE_INVALID',
              panelMessage: 'Use a whole-dollar paid-call rate from $1 to $1,000.',
            });
          }
          intent.paid = {
            enabled: paidEnabled,
            title,
            price_dollars: paidEnabled ? Number(rawRate) : null,
          };
        }

        return intent;
      }

      async function saveBuildCallSettingsIntent(intent) {
        if (!intent) return null;
        const memberstack = window.$memberstackDom;
        if (
          !memberstack ||
          typeof memberstack.getMemberJSON !== 'function' ||
          typeof memberstack.updateMemberJSON !== 'function'
        ) {
          throw Object.assign(new Error('Member Call Settings storage is unavailable.'), {
            code: 'CALL_SETTINGS_INTENT_STORAGE_UNAVAILABLE',
            panelMessage: 'We saved your profile but could not save your Call Settings. Please submit again.',
          });
        }
        await queueMemberJsonWrite(async function () {
          const response = await memberstack.getMemberJSON();
          const current = response && Object.prototype.hasOwnProperty.call(response, 'data')
            ? response.data
            : response;
          const memberJSON = current && typeof current === 'object' && !Array.isArray(current)
            ? current
            : {};
          await memberstack.updateMemberJSON({
            json: {
              ...memberJSON,
              [BUILD_CALL_INTENT_KEY]: intent,
            },
          });
        });
        return intent;
      }

      function clearPriceFeedback(field) {
        const feedback = priceFeedback.get(field);
        if (!feedback) return;
        if (field.validationMessage === feedback.message) field.setCustomValidity?.('');
        priceFeedback.delete(field);
      }

      function clearChangedPriceFeedback(event) {
        const field = event.target;
        const feedback = priceFeedback.get(field);
        if (feedback && field.value !== feedback.value) clearPriceFeedback(field);
      }

      ['rate', 'rate-retainer'].forEach((name) => {
        const field = qs('[name="' + name + '"]', form);
        field?.addEventListener('input', clearChangedPriceFeedback);
        field?.addEventListener('change', clearChangedPriceFeedback);
      });

      function paintErrorMessage(message) {
        if (errorMessage) errorMessage.textContent = message || authoredErrorMessage;
      }

      function resetSubmitFeedback() {
        paintErrorMessage(null);
        priceFeedback.forEach((feedback, field) => clearPriceFeedback(field));
      }

      // A CORS/preflight or transport failure rejects with no response delivered,
      // which does not prove the request never reached the server. Chrome reports
      // "Failed to fetch", Firefox "NetworkError when attempting to fetch resource",
      // WebKit "Load failed", "The network connection was lost." or "cancelled" - the
      // last two are what a dropped mobile connection raises once the POST is already
      // out. A TypeError raised before the request leaves the page - a replaced
      // xanoAuthFetch bridge, say - is a deterministic failure, so it owns its own
      // cause instead of an unconfirmed-save recovery.
      const TRANSPORT_RETRY_DELAY_MS = 400;
      const TRANSPORT_FAILURE_RE =
        /failed to fetch|networkerror|load failed|network connection was lost|cancelled/i;
      const isTransportFailure = (candidate) => candidate?.code === 'NETWORK_ERROR'
        || (candidate?.name === 'TypeError' && TRANSPORT_FAILURE_RE.test(candidate?.message || ''));

      async function saveCanonicalProfile(endpointUrl, payload) {
        const request = () => xanoAuthFetch(endpointUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        try {
          return await request();
        } catch (firstError) {
          if (!isTransportFailure(firstError)) throw firstError;
          // The profile write is an upsert and its projection intent is versioned, so
          // replaying the identical payload once is safe. Wait briefly first so the
          // second attempt does not land inside the same transient condition. Retry
          // the payload once, and never retry an HTTP response.
          await new Promise((resolve) => { setTimeout(resolve, TRANSPORT_RETRY_DELAY_MS); });
          try {
            return await request();
          } catch (retryError) {
            if (!isTransportFailure(retryError)) throw retryError;
            throw Object.assign(retryError, {
              code: 'PROFILE_SAVE_NETWORK_ERROR',
              panelMessage: 'We could not confirm your profile was saved. Please wait a moment, then submit again.',
            });
          }
        }
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
          clearPriceFeedback(field);
          if (!field.validationMessage || !field.validity?.customError) {
            field.setCustomValidity?.(message);
            priceFeedback.set(field, { message, value: field.value });
          }
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
          clearPriceFeedback(field);
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

        const callSettingsIntent = buildCallSettingsIntent(formData);

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

          // Call availability belongs to Dashboard Call Settings and its active
          // environment-matched configuration. Build Profile must not compete with
          // that writer or project stale hidden controls back into canonical state.

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
            const response = await saveCanonicalProfile(ENDPOINT_URL, payload);

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

          await saveBuildCallSettingsIntent(callSettingsIntent);

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
