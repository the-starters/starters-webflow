// Docs: https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/custom-algolia-scripts/filters-text

(function () {
  var FIELD_LABELS = {
    "functions": "Function",
    "roles": "Role",
    "also-worked-with": "Company",
    "country": "Country",
    "city": "City",
    "state": "State",
    "fulltime-toggle": "Full Time?",
    "availability": "Availability",
    "industries": "Industry",
    "rate": "Rate"
  };

  function humanize(s) {
    return s
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function prettyField(raw) {
    return FIELD_LABELS[raw] || humanize(raw);
  }

  // Keep fixed bucket values like "1-10", "21-40" intact
  function prettyValue(field, raw) {
    if (/^\d+\s*[-–]\s*\d+$/.test(raw)) {
      return raw.replace(/\s*-\s*/g, "–"); // optional: hyphen -> en-dash
    }
    // Rate range chips from WF-Algolia already come formatted ("30 – 500", "$30 – $500")
    if (field === "rate") return raw;
    return humanize(raw);
  }

  function processSlot(el) {
    var raw = el.textContent;
    if (!raw) return;
    var pretty = prettyValue("", raw);
    if (pretty !== raw) el.textContent = pretty;
  }

  function processChip(el) {
    var raw = el.textContent;
    if (!raw) return;
    var idx = raw.indexOf(": ");
    if (idx === -1) {
      var whole = humanize(raw);
      if (whole !== raw) el.textContent = whole;
      return;
    }
    var fieldKey = raw.slice(0, idx);
    var field = prettyField(fieldKey);
    var value = prettyValue(fieldKey, raw.slice(idx + 2));
    var next = field + ": " + value;
    if (next !== raw) el.textContent = next;
  }

  function processAll(root) {
    var r = root || document;
    r.querySelectorAll('[wf-algolia-element="filter-value-text"]').forEach(processSlot);
    r.querySelectorAll('[wf-algolia-element="filter-tag-text"]').forEach(processChip);
  }

  function init() {
    processAll(document);

    if (window.WfAlgolia) {
      window.WfAlgolia.on("response", function () {
        requestAnimationFrame(function () { processAll(document); });
      });
      window.WfAlgolia.on("filter", function () {
        requestAnimationFrame(function () { processAll(document); });
      });
    }

    var observer = new MutationObserver(function () {
      observer.disconnect();
      processAll(document);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();