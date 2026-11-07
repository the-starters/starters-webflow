(function () {
  const ENABLED_HOSTS = ['the-starters-3-0.webflow.io'];
  if (!ENABLED_HOSTS.includes(window.location.hostname)) return;
  if (window.__startersModalCampaignsInit) return;
  window.__startersModalCampaignsInit = true;

  const SKIP_PATHS = [
    '/login', '/starter-login', '/sign-up', '/build-profile', '/starter-onboarding',
    '/stripe-connect-callback', '/checkout', '/cancel', '/modals',
  ];
  const AUDIENCES = {
    'signed-out': 'aud-signed-out', 'brand-free': 'aud-brand-free',
    'brand-paid': 'aud-brand-paid', talent: 'aud-starter',
  };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const normalize = (path) => path.replace(/\/+$/, '') || '/';
  const currentPath = () => normalize(window.location.pathname);
  const blocked = () => SKIP_PATHS.some((path) => currentPath() === path || currentPath().startsWith(path + '/')) ||
    Boolean(document.querySelector('dialog[open]'));

  function dateBoundary(value, end) {
    if (!value) return end ? Infinity : -Infinity;
    const match = /^([A-Za-z]+) ([1-9]|[12]\d|3[01]), (\d{4})$/.exec(value);
    if (!match) return NaN;
    const month = MONTHS.indexOf(match[1]);
    if (month === -1) return NaN;
    const day = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(0);
    date.setFullYear(year, month, day);
    date.setHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return NaN;
    return date.getTime();
  }

  function destinationMatches(value, path) {
    if (!value) return false;
    const segments = path.split('/');
    return value.split(',').some((destination) => {
      const pattern = normalize(destination.trim());
      if (!destination.trim().startsWith('/')) return false;
      const parts = pattern.split('/');
      return parts.length === segments.length && parts.every((part, index) =>
        part === segments[index] || (part === '*' && segments[index] !== ''));
    });
  }

  function campaign(row, audience, path) {
    const value = (name) => row.getAttribute('data-popup-' + name);
    if (value('active') !== 'true' || value(AUDIENCES[audience]) !== 'true') return null;
    if (!destinationMatches(value('destinations'), path)) return null;
    const key = value('campaign');
    const priority = Number(value('priority'));
    const start = dateBoundary(value('start'), false);
    const end = dateBoundary(value('end'), true);
    const now = Date.now();
    if (!key || !Number.isInteger(priority) || Number.isNaN(start) || Number.isNaN(end) || start > now || end < now) return null;
    return { key, priority, start, end };
  }

  function wireHistory(modal, entry, key) {
    async function record(event) {
      try { return await modal.history.record(key, event); }
      catch (_) { return false; }
    }
    window.addEventListener('modal-close', (event) => {
      if (event.detail?.modal === entry.el) record('dismissed');
    });
    entry.el.addEventListener('click', (event) => {
      const control = event.target?.closest?.('a, button');
      if (control && entry.el.contains(control)) record('cta');
    });
    return record('shown');
  }

  async function choose(sourceUrl) {
    try {
      if (blocked()) return null;
      const modal = window.lumos.modal;
      const audience = await modal.audience();
      if (!Object.hasOwn(AUDIENCES, audience) || blocked()) return null;
      const doc = await modal.source(sourceUrl);
      if (!doc || blocked()) return null;
      const path = currentPath();
      const unseen = [];
      for (const row of doc.querySelectorAll('.w-dyn-item[data-popup-campaign]')) {
        const candidate = campaign(row, audience, path);
        if (candidate && await modal.history.hasShown(candidate.key) === false) unseen.push(candidate);
        if (blocked() || currentPath() !== path) return null;
      }
      unseen.sort((a, b) => b.priority - a.priority || (b.start > a.start ? 1 : b.start < a.start ? -1 : 0));
      const selected = unseen[0];
      if (!selected || blocked()) return null;
      const entry = await modal.load(sourceUrl, selected.key, { open: false });
      if (!entry || blocked() || currentPath() !== path || selected.start > Date.now() || selected.end < Date.now()) return null;
      entry.open();
      if (entry.el.open !== true) return null;
      await wireHistory(modal, entry, selected.key);
      return entry;
    } catch (_) {
      return null;
    }
  }

  let result;
  function run(sourceUrl = '/modals') {
    if (!result) result = choose(sourceUrl);
    return result;
  }

  function startInstall() {
    const started = Date.now();
    (function install() {
      const modal = window.lumos?.modal;
      if (typeof modal?.init === 'function') modal.campaigns = { run };
      else if (Date.now() - started < 4000) setTimeout(install, 50);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startInstall, { once: true });
  else startInstall();
})();
