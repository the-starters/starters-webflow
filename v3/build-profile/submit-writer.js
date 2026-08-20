
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

      success.style.display = 'none';
      error.style.display = 'none';

      // custom form submission handler
      formSubmit.addEventListener('click', async function (e) {
        e.preventDefault();

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

        const result = await submitFreelancerData(data);
        console.log("Normalized Data:", result);
      });

      async function submitFreelancerData(formData) {
        const ENDPOINT_URL = "https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/build_profile/starter/update";

        const toBool = (value) => {
          if (value === "yes") return true;
          if (value === "no") return false;
          return value;
        };

        const toInteger = (value) => {
          if (value === undefined || value === null || value === "") return null;

          const number = Number(value);
          if (Number.isNaN(number)) return null;

          return Math.round(number);
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
          if (!reviewer || !reviewer.fname || !reviewer.email) return null;

          return {
            "first-name": reviewer.fname || "",
            "last-name": reviewer.lname || "",
            position: reviewer.job || "",
            company: reviewer.company || "",
            email: reviewer.email || "",
          };
        };

        function requiredServicesFields(data) {
          if (!data || !data.name || !data.price) return null;

          return data;
        }

        const services = {
          "service-1": requiredServicesFields(parseJson(formData.service)),
          "service-2": requiredServicesFields(parseJson(formData["service-2"])),
          "service-3": requiredServicesFields(parseJson(formData["service-3"])),
        };

        const reviewers = {
          "reviewer-1": normalizeReviewer(parseJson(formData.reviewer)),
          "reviewer-2": normalizeReviewer(parseJson(formData["reviewer-2"])),
          "reviewer-3": normalizeReviewer(parseJson(formData["reviewer-3"])),
        };

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

          hourly_rate: toInteger(formData.rate),

          availability: formData["availability-option"] || "",
          availability_id: formData.availability || "",

          full_time: toBool(formData["full-time-placement"]),

          free_call: toBool(formData["free-consulting-calls"]),
          free_call_desc: formData["free-call-description"] || "",

          paid_call: toBool(formData["paid-consulting-calls"]),
          paid_call_desc: formData["paid-call-description"] || "",
          paid_call_rate: toInteger(formData["paid-call-rate"]),

          retainer: toBool(formData["offer-monthly-retainers"]),
          retainer_desc: formData["description-retainer"] || "",
          retainer_rate: toInteger(formData["rate-retainer"]),

          services,
          reviewers,

          also_worked_with: parseJson(formData["also-worked-with"]),

          updated: Date.now(),
        };

        //if (localStorage.getItem('submit_profile')) {
          const step = formSubmit.closest('[data-form="step"]');
          setLoader(true, step);

          const response = await xanoAuthFetch(ENDPOINT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            setLoader(false, step);
            success.style.display = 'none';
            error.style.display = 'block';

            const errorText = await response.text();
            throw new Error(`Xano request failed: ${response.status} ${errorText}`);
          }

          // update Member customFields, if even one of them was changed
          if (
            MEMBER.customFields?.['free-user']?.toLowerCase().trim() !== (payload['first_name'] || '').toLowerCase().trim() ||
            MEMBER.customFields?.['last-name']?.toLowerCase().trim() !== (payload['last_name'] || '').toLowerCase().trim() ||
            MEMBER.customFields?.['phone']?.toLowerCase().trim() !== (payload['phone'] || '').toLowerCase().trim()
          ) {
            try {
              await window.$memberstackDom.updateMember({
                customFields: {
                  'free-user': payload.first_name || '',
                  'last-name': payload.last_name || '',
                  'phone': payload.phone || '',
                }
              });
            } catch (error) {
              console.error("Failed to update Member customFields:", error);
            }
          }

          // update email, if it was changed
          if (MEMBER.auth.email?.trim() !== payload.email?.trim()) {
            try {
              await window.$memberstackDom.updateMemberAuth({
                email: payload.email,
              });
            } catch (error) {
              console.error("Failed to update Member email:", error);
            }
          }

          const successName = qs('[data-value="first-name"]', success);
          if (successName) successName.textContent = payload.first_name || '';

          const successCTA = qs('[dashboard-button-wrap] .button', success);
          if (successCTA) {
            const redirectUrl = MEMBER.customFields?.['freelancer-dashboard-url'] || MEMBER.customFields?.['freelancer-profile-url'] || '/starter-dashboard';
            successCTA.href = redirectUrl;
          }

          setLoader(false, step);
          form.style.display = 'none';
          error.style.display = 'none';
          success.style.display = 'block';

          console.log("payload:", payload);

          return await response.json();
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
