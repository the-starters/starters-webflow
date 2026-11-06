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

  function copyEntries(parsed) {
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
  }

  function guestEntries() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return copyEntries(raw === null ? {} : JSON.parse(raw));
    } catch (_) {
      return null;
    }
  }

  function memberJson(response) {
    if (response && isMap(response.data)) return response.data;
    return isMap(response) ? response : {};
  }

  function queueMemberJsonWrite(task) {
    const previous = window.__tsMemberJsonWrite || Promise.resolve();
    const next = previous.then(task, task);
    window.__tsMemberJsonWrite = next.then(() => {}, () => {});
    return next;
  }

  function lookupMember(memberstack) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 3000);
      try {
        Promise.resolve(memberstack.getCurrentMember()).then((response) => {
          clearTimeout(timer);
          resolve(response?.data?.id ? response.data : false);
        }, () => { clearTimeout(timer); resolve(null); });
      } catch (_) {
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  const merges = new Map();
  async function store() {
    const memberstack = window.$memberstackDom;
    const member = await lookupMember(memberstack);
    if (member === null) return null;
    if (member === false) return { memberstack: null };
    if (!merges.has(member.id)) {
      const guest = guestEntries();
      if (guest === null) return null;
      if (Object.keys(guest).length) {
        merges.set(member.id, queueMemberJsonWrite(async () => {
          const json = memberJson(await memberstack.getMemberJSON());
          const entries = copyEntries(json.popups ?? {});
          if (entries === null) return false;
          for (const [key, guestEntry] of Object.entries(guest)) {
            const entry = entries[key] || { shownAt: null, dismissedAt: null, ctaAt: null };
            for (const field of fields) {
              if (guestEntry[field] && (!entry[field] || guestEntry[field] < entry[field])) entry[field] = guestEntry[field];
            }
            entries[key] = entry;
          }
          await memberstack.updateMemberJSON({ json: { ...json, popups: entries } });
          return true;
        }).catch(() => false));
      }
    }
    if (merges.has(member.id) && !await merges.get(member.id)) return null;
    return { memberstack };
  }

  async function readEntries(target) {
    if (!target) return null;
    if (!target.memberstack) return guestEntries();
    try {
      const json = memberJson(await target.memberstack.getMemberJSON());
      return copyEntries(json.popups ?? {});
    } catch (_) {
      return null;
    }
  }

  const history = {
    async hasShown(key) {
      if (!validKey(key)) return null;
      const entries = await readEntries(await store());
      return entries === null ? null : Boolean(entries[key]?.shownAt);
    },
    async record(key, event) {
      if (!validKey(key) || !Object.hasOwn(EVENTS, event)) return false;
      const target = await store();
      if (!target) return false;
      const field = EVENTS[event];
      const write = async () => {
        try {
          const json = target.memberstack ? memberJson(await target.memberstack.getMemberJSON()) : null;
          const entries = json ? copyEntries(json.popups ?? {}) : guestEntries();
          if (entries === null) return false;
          const entry = entries[key] || { shownAt: null, dismissedAt: null, ctaAt: null };
          if (entry[field]) return true;
          entry[field] = new Date().toISOString();
          entries[key] = entry;
          if (json) await target.memberstack.updateMemberJSON({ json: { ...json, popups: entries } });
          else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
          return true;
        } catch (_) {
          return false;
        }
      };
      return target.memberstack ? queueMemberJsonWrite(write) : write();
    },
    async entries() {
      return readEntries(await store());
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
