
  var profileFormControllers = window.__tsProfileFormControllers || (window.__tsProfileFormControllers = {});
  if (!profileFormControllers.buildProfileDraftState) {
  profileFormControllers.buildProfileDraftState = true;
  document.addEventListener('DOMContentLoaded', function () {
    setLoader(true);

    /* saving draft data */
    waitForMember(async () => {
      if (!MEMBER.id) return;

      const LOCAL_STORAGE_KEY = 'ts:build_profile:member:' + MEMBER.id;
      const localProfile = getLocalProfile();

      console.log("localProfile", localProfile);
      console.log("localProfile type", localProfile?.type);

      /* WF_ids for profile types:
        full - a52dcf2c568fa40bf96cd67e4f8c6186
        consult - ca6ff4250b7d01b49e83433432af3686
      */
      const PROFILE_TYPE = localProfile?.type || 'full';
      const PROFILE_TYPE_ID = localProfile?.type_id || 'a52dcf2c568fa40bf96cd67e4f8c6186';

      let memberJSON = {};

      // `var activeProfile` and `function createEmptyProfile()` - are in global page codes

      if (!window.$memberstackDom) {
        console.warn('Memberstack DOM is not available');
        return;
      }

      initProfileDraft();

      async function initProfileDraft() {
        try {
          let memberStart = Date.now();
          console.log("Get MemberJSON - starting...", memberStart);
          memberJSON = await getMemberJSONSafe();
          console.log("Get MemberJSON - finished:", Date.now() - memberStart, "ms");

          const memberProfile = normalizeProfile(memberJSON?.build_profile, true);
          activeProfile = getNewestProfile(memberProfile, localProfile);
          console.log('Active profile', activeProfile);

          const steps = getSteps();

          ensureStepsInProfile(activeProfile, steps);
          restoreFieldsData(activeProfile);
          updateCounterFields();

          setTimeout(() => {
            setLoader(false);
          }, 300);

          saveProfileToLocalStorage(activeProfile);

          if ((localProfile?.last_update || 0) > (memberProfile?.last_update || 0)) {
            await saveProfileToMemberJSON(activeProfile, memberJSON);
          }

          bindNextButtons();

          document.addEventListener('change', (event) => bindCaptureField(event.target));
          document.addEventListener('input', (event) => bindCaptureField(event.target));
        } catch (error) {
          console.error('Profile draft init error:', error);
        }
      }

      async function saveProfileData(step, isNextBtn = false) {
        const stepIndex = getStepIndex(step);
        const stepKey = `step_${stepIndex}`;
        const stepData = collectStepData(step);

        activeProfile = {
          ...activeProfile,
          type: PROFILE_TYPE,
          type_id: PROFILE_TYPE_ID,
          last_update: Date.now(),
          data: {
            ...(activeProfile.data || {}),
            [stepKey]: stepData,
          },
        };

        saveProfileToLocalStorage(activeProfile);

        if (!isNextBtn) return;

        try {
          await saveProfileToMemberJSON(activeProfile);
        } catch (error) {
          console.error('Save profile to MemberJSON error:', error);
        }
      }

      function bindCaptureField(target) {
        const captureField = target.closest('[data-input-capture]');
        if (!captureField) return;

        const step = captureField.closest('[data-form="step"]');
        if (!step) return;

        saveProfileData(step);
      }

      function bindNextButtons() {
        const steps = getSteps();
        steps.forEach((step) => {
          const btns = qsa('[data-form="next-btn"], [form-submit]', step);
          btns.forEach((btn) => {
            btn.addEventListener('click', () => saveProfileData(step, true));
          });
        });
      }

      function collectStepData(step) {
        const fields = qsa('[data-input-capture]', step);
        const data = {};

        fields.forEach((field) => {
          const fieldName = field.name;
          if (!fieldName) return;

          if (fieldName === "phone") {
            const phoneInput = window.intlTelInput?.getInstance(field);
            if (phoneInput) {
              data[fieldName] = phoneInput.getNumber() || getFieldValue(field) || '';
              return;
            }
          }

          data[fieldName] = getFieldValue(field);
        });

        return data;
      }

      function restoreFieldsData(profile) {
        const steps = getSteps();
        steps.forEach((step) => {
          const stepIndex = getStepIndex(step);
          if (!stepIndex) return;

          const stepKey = `step_${stepIndex}`;
          const stepData = profile?.data?.[stepKey];

          if (!stepData) return;

          const memberFieldsMapping = {
            'first-name': 'free-user',
            'last-name': 'last-name',
            'phone': 'phone'
          };

          const fields = qsa('[data-input-capture]', step);
          fields.forEach((field) => {
            if (field.hasAttribute('data-ms-member')) {
              setTimeout(() => {
                field.dispatchEvent(new Event('input', { bubbles: true }));
                field.dispatchEvent(new Event('change', { bubbles: true }));
              }, 50);

              if (
                field.name !== 'email' &&
                activeProfile?.data?.["step_1"]?.[field.name]?.trim() === MEMBER.customFields?.[memberFieldsMapping[field.name]]?.trim()
              ) {
                return;
              }

              if (
                field.name === 'email' &&
                activeProfile?.data?.["step_1"]?.["email"]?.trim() === MEMBER.auth.email?.trim()
              ) {
                return;
              }
            }

            const fieldName = field.name;
            if (!fieldName || !(fieldName in stepData)) return;

            setFieldValue(field, stepData[fieldName]);
          });
        });
      }

      function getFieldValue(field) {
        const tagName = field.tagName.toLowerCase();
        const type = field.getAttribute('type');

        if (type === 'checkbox') {
          return field.checked;
        }

        if (type === 'radio') {
          const checkedRadio = qs(`input[type="radio"][name="${CSS.escape(field.name)}"]:checked`);

          return checkedRadio ? checkedRadio.value : '';
        }

        if (tagName === 'select' && field.multiple) {
          return Array.from(field.selectedOptions).map((option) => option.value);
        }

        let val = field.value.trim();
        if (val.endsWith(',')) {
          val = val.slice(0, -1);
        }

        return val;
      }

      function setFieldValue(field, value) {
        const tagName = field.tagName.toLowerCase();
        const type = field.getAttribute('type');

        if (type === 'checkbox') {
          field.checked = Boolean(value);
          triggerNativeEvents(field);
          return;
        }

        if (type === 'radio') {
          const radio = qs(`input[type="radio"][name="${CSS.escape(field.name)}"][value="${CSS.escape(value)}"]`);

          if (radio) {
            radio.checked = true;
            triggerNativeEvents(radio);
          }

          return;
        }

        field.value = value ?? '';
        triggerNativeEvents(field);
      }

      function triggerNativeEvents(field) {
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      }

      async function getMemberJSONSafe() {
        try {
          const response = await window.$memberstackDom.getMemberJSON();

          return response?.data || response || {};
        } catch (error) {
          console.error('Get MemberJSON error:', error);
          return {};
        }
      }

      async function saveProfileToMemberJSON(profile, memberJSON = null) {
        const latestMemberJSON = memberJSON || await getMemberJSONSafe();

        const updatedMemberJSON = {
          ...latestMemberJSON,
          build_profile: profile,
        };

        await window.$memberstackDom.updateMemberJSON({
          json: updatedMemberJSON,
        });

        memberJSON = updatedMemberJSON;
      }

      function getLocalProfile() {
        try {
          const rawProfile = localStorage.getItem(LOCAL_STORAGE_KEY);
          if (!rawProfile) return null;

          return normalizeProfile(JSON.parse(rawProfile));
        } catch (error) {
          console.error('Parse local profile error:', error);
          return null;
        }
      }

      function saveProfileToLocalStorage(profile) {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(profile));
      }

      function getNewestProfile(memberProfile, localProfile) {
        const memberLastUpdate = Number(memberProfile?.last_update || 0);
        const localLastUpdate = Number(localProfile?.last_update || 0);

        if (localLastUpdate > memberLastUpdate) {
          console.log('Using local profile as the newest profile');
          return localProfile;
        }

        if (memberLastUpdate > 0) {
          console.log('Using member profile as the newest profile');
          return memberProfile;
        }

        return createEmptyProfile(PROFILE_TYPE, PROFILE_TYPE_ID, Date.now());
      }

      function normalizeProfile(profile, isMemberProfile = false) {
        if (!profile || typeof profile !== 'object') {
          return createEmptyProfile(PROFILE_TYPE, PROFILE_TYPE_ID, isMemberProfile ? 0 : Date.now());
        }

        return {
          type: profile.type || PROFILE_TYPE,
          type_id: profile.type_id || PROFILE_TYPE_ID,
          last_update: Number(profile.last_update || Date.now()),
          data: profile.data && typeof profile.data === 'object' ? profile.data : {},
        };
      }

      function ensureStepsInProfile(profile, steps) {
        if (!profile.data) {
          profile.data = {};
        }

        steps.forEach((step) => {
          const stepIndex = getStepIndex(step);
          if (!stepIndex) return;

          const stepKey = `step_${stepIndex}`;

          if (!profile.data[stepKey]) {
            profile.data[stepKey] = {};
          }
        });
      }

      function getSteps() {
        return Array.from(qsa('[data-form="step"]'));
      }

      function getStepIndex(step) {
        return step.getAttribute('data-index');
      }
    });
  });

  function updateCounterFields() {
    const inputs = qsa('input.with-count, textarea.with-count');
    inputs.forEach((input) => {
      const wrapper = input.closest('.form_input-wr');
      if (!wrapper) return;

      const countSpan = qs('.count-input', wrapper);
      if (!countSpan) return;

      const byWords = input.hasAttribute('count-by-words');
      const currentLength = byWords ? countWords(input.value) : (input.value || '').trim().length;

      countSpan.textContent = String(currentLength).padStart(2, '0');
    });
  }

  function countWords(value) {
    const normalizedValue = (value || '').trim();
    if (!normalizedValue) return 0;

    return normalizedValue
      .split(/\s+/)
      .filter(Boolean)
      .length;
  }
  }
