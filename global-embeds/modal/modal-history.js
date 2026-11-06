(function () {
  const ENABLED_HOSTS = ['the-starters-3-0.webflow.io'];
  if (!ENABLED_HOSTS.includes(window.location.hostname)) return;
  if (window.__startersModalHistoryInit) return;
  window.__startersModalHistoryInit = true;

  const STORAGE_KEY = 'thestarters:modal-popups';
  const EVENTS = { shown: 'shownAt', dismissed: 'dismissedAt', cta: 'ctaAt' };
  const fields = Object.values(EVENTS);
  const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const validKey = (key) => typeof key === 'string' && key.length > 0;

  function validTime(value) {
    if (value == null) return true;
    if (typeof value !== 'string') return false;
    const time = new Date(value);
    return Number.isFinite(time.getTime()) && time.toISOString() === value;
  }

  function guestEntries() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw === null ? {} : JSON.parse(raw);
      if (!isMap(parsed)) return null;
      const copy = Object.create(null);
      for (const [key, entry] of Object.entries(parsed)) {
        if (!validKey(key) || !isMap(entry) || !fields.every((field) => validTime(entry[field]))) return null;
        copy[key] = {
          shownAt: entry.shownAt ?? null,
          dismissedAt: entry.dismissedAt ?? null,
          ctaAt: entry.ctaAt ?? null,
        };
      }
      return copy;
    } catch (_) {
      return null;
    }
  }

  const history = {
    async hasShown(key) {
      if (!validKey(key)) return null;
      const entries = guestEntries();
      return entries === null ? null : Boolean(entries[key]?.shownAt);
    },
    async record(key, event) {
      if (!validKey(key) || !Object.hasOwn(EVENTS, event)) return false;
      const entries = guestEntries();
      if (entries === null) return false;
      const field = EVENTS[event];
      const entry = entries[key] || { shownAt: null, dismissedAt: null, ctaAt: null };
      if (entry[field]) return true;
      entry[field] = new Date().toISOString();
      entries[key] = entry;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
        return true;
      } catch (_) {
        return false;
      }
    },
    async entries() {
      return guestEntries();
    },
  };

  function startInstall() {
    const started = Date.now();
    (function install() {
      const modal = window.lumos?.modal;
      if (typeof modal?.init === 'function') modal.history = history;
      else if (Date.now() - started < 4000) setTimeout(install, 50);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startInstall, { once: true });
  else startInstall();
})();
