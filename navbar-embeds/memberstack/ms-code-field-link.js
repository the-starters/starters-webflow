
  document.addEventListener("DOMContentLoaded", function() {
    const memberData = JSON.parse(localStorage.getItem('_ms-mem') || '{}');
    if (!memberData?.id) return;

    document.querySelectorAll('[ms-code-field-link]').forEach(element => {
      const fieldKey = element.getAttribute('ms-code-field-link');
      const fieldValue = memberData.customFields?.[fieldKey]?.trim();

      if (!fieldValue) {
        element.style.display = 'none';
        return;
      }

      try {
        // Add protocol if missing and validate URL
        const url = !/^https?:\/\//i.test(fieldValue) ? 'https://' + fieldValue : fieldValue;
        new URL(url); // Will throw if invalid URL

        element.href = url;
        element.rel = 'noopener noreferrer';
        element.target = '_blank';
      } catch {
        element.style.display = 'none';
      }
    });
  });