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

  // Display-name overrides for role slugs that plain de-hyphenate+capitalize
  // mangles (acronyms, and one plural). Keyed on the RAW stored slug.
  // KEEP IN SYNC across:
  //   starters-list-filter/custom-algolia-scripts/filters-text.js
  //   algolia-result-modifiers/roles.js
  //   v3/saved-starters-roles.js
  //   v3/onboarding-profile-preview.js
  var ROLE_NAMES = {
    'ui-ux-designer': 'UI/UX Designer',
    'cro-expert': 'CRO Expert',
    'seo-marketer': 'SEO Marketer',
    'crm-marketer': 'CRM Marketer',
    'cx-director': 'CX Director',
    'pr-directors': 'PR Director',
    'ai-automation-expert': 'AI Automation Expert',
    'e-commerce-manager': 'E-Commerce Manager'
  };

  // Display-name overrides for SKILL slugs. Same problem as roles: skills are
  // stored as slugs ("ab-testing"), and humanize() only title-cases words, so
  // every acronym comes out wrong ("Ab Testing").
  //
  // Most of this map was harvested from the Algolia index itself: a handful of
  // records carry an unsplit, comma-joined skill LIST as a single facet value
  // (see the dirty-data note in the README), and those strings spell the
  // canonical display names. Those entries are authoritative, not guesses.
  // The rest follow the house style those entries establish: a trailing
  // acronym goes in parentheses, a leading/standalone acronym is uppercased.
  //
  // Keyed on the RAW stored slug. No key here collides with a ROLE_NAMES key.
  var SKILL_NAMES = {
    // — canonical names found verbatim in the index —
    'ab-testing': 'A/B Testing',
    'tiktok-ads': 'TikTok Ads',
    'tiktok-organic': 'TikTok (Organic)',
    'youtube-ads': 'YouTube Ads',
    'youtube-organic': 'YouTube (Organic)',
    'instagram-organic': 'Instagram (Organic)',
    'pinterest-organic': 'Pinterest (Organic)',
    'amazon-e-commerce': 'Amazon E-Commerce',
    'walmart-e-commerce': 'Walmart E-Commerce',
    'amazon-seo': 'Amazon SEO',
    'ai-automation': 'AI Automation',
    'ai-strategy': 'AI Strategy',
    'ai-agents': 'AI Agents',
    'user-interface-ui-design': 'User Interface (UI) Design',
    'agile-frameworks-scrum-kanban': 'Agile Frameworks (Scrum & Kanban)',
    'software-development-lifecycle-sdlc': 'Software Development Lifecycle (SDLC)',
    'rag-retrieval-augmented-generation': 'RAG (Retrieval-Augmented Generation)',
    'ltv-cac-analysis': 'LTV / CAC Analysis',
    'co-manufacturer-management': 'Co-Manufacturer Management',
    'fp-a': 'FP&A',

    // — house style applied to the remaining mangled acronyms —
    'conversion-rate-optimization-cro': 'Conversion Rate Optimization (CRO)',
    'search-engine-optimization-seo': 'Search Engine Optimization (SEO)',
    'user-experience-ux-design': 'User Experience (UX) Design',
    'content-creation-ugc': 'Content Creation (UGC)',
    'revenue-recognition-asc-606': 'Revenue Recognition (ASC 606)',
    'crm-strategy': 'CRM Strategy',
    'sms-marketing': 'SMS Marketing',
    'ugc-sourcing': 'UGC Sourcing',
    'amazon-ppc': 'Amazon PPC',
    'esp-migration': 'ESP Migration',
    'dsp-management': 'DSP Management',
    'llm-evaluations': 'LLM Evaluations',
    'llmops': 'LLMOps',
    'tiktok-shop': 'TikTok Shop',
    'customgpts': 'CustomGPTs',
    'html': 'HTML',
    'css': 'CSS',
    'sql': 'SQL'
  };

  // This file re-reads and rewrites the SAME nodes on every engine response, so
  // every emitted label must map to itself on the next pass or the text
  // oscillates. Not every display value is a humanize() fixed point:
  // humanize("E-Commerce Manager") drops the hyphen, and humanize("A/B Testing")
  // would survive but humanize("LTV / CAC Analysis") must not be re-split. So
  // already-mapped labels are matched back to themselves here, keyed on the
  // lowercased display value. Both maps feed it.
  var VALUE_DISPLAY = Object.create(null);
  [ROLE_NAMES, SKILL_NAMES].forEach(function (map) {
    Object.keys(map).forEach(function (slug) {
      VALUE_DISPLAY[map[slug].toLowerCase()] = map[slug];
    });
  });

  // Applies to every field, not just "roles"/"skills": the keys are exact
  // stored slugs, so no other facet value can collide with one.
  function prettyRole(raw) {
    var key = raw.trim().toLowerCase();
    return ROLE_NAMES[key] || SKILL_NAMES[key] || VALUE_DISPLAY[key] || null;
  }

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
    return prettyRole(raw) || humanize(raw);
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
      // A bare chip carries just the value, so it takes the same
      // map-then-humanize path a "Field: value" chip's value half takes.
      var whole = prettyRole(raw) || humanize(raw);
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