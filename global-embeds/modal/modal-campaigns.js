(function () {
  const ENABLED_HOSTS = ['the-starters-3-0.webflow.io'];
  if (!ENABLED_HOSTS.includes(window.location.hostname)) return;
  if (window.__startersModalCampaignsInit) return;
  window.__startersModalCampaignsInit = true;

  const params = new URLSearchParams(window.location.hostname === 'the-starters-3-0.webflow.io' ? window.location.search : '');
  const overrides = params.has('popup-as') ? new Set(params.get('popup-as').split(',').map((value) => value.trim())) : null;
  const resetRequested = params.get('popup-reset') === '1';
  if (resetRequested) {
    try { window.localStorage.removeItem('thestarters:modal-popups'); } catch (_) {}
  }
  const debug = (key, reason) => {
    if (params.get('popup-debug') === '1') console.log('[popups] ' + key + ' → ' + (reason ? 'skipped: ' + reason : 'matched'));
  };

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
    return value.split(/,|\r?\n|<br\s*\/?\s*>/i).map((destination) => destination.trim()).filter(Boolean).some((destination) => {
      const pattern = normalize(destination.trim());
      if (!destination.trim().startsWith('/')) return false;
      const parts = pattern.split('/');
      return parts.length === segments.length && parts.every((part, index) =>
        part === segments[index] || (part === '*' && segments[index] !== ''));
    });
  }

  function campaign(row, audience, path, skip) {
    const value = (name) => row.getAttribute('data-popup-' + name);
    if (value('active') !== 'true') return skip('inactive');
    if (value(AUDIENCES[audience]) !== 'true') return skip('audience');
    if (!destinationMatches(value('destinations'), path)) return skip('destination');
    const key = value('campaign');
    const priority = Number(value('priority'));
    const start = dateBoundary(value('start'), false);
    const end = dateBoundary(value('end'), true);
    const now = Date.now();
    if (!key || !Number.isInteger(priority)) return skip('rules');
    if (Number.isNaN(start) || Number.isNaN(end) || start > now || end < now) return skip('dates');
    return { key, priority, start, end, value };
  }

  function behaviourProblem(candidate, audience) {
    for (const name of ['new-days', 'renew-days']) {
      const raw = candidate.value(name);
      if (raw === null || raw === '') continue;
      if (!Number.isInteger(Number(raw)) || Number(raw) < 0) return name;
      if (audience === 'signed-out' || (name === 'renew-days' && audience !== 'brand-paid')) return 'audience';
    }
    for (const name of ['no-availability', 'no-stripe']) {
      const raw = candidate.value(name);
      if (raw !== null && !['', 'true', 'false'].includes(raw)) return 'rules';
    }
    if (audience !== 'talent' && ['no-availability', 'no-stripe'].some((name) => candidate.value(name) === 'true')) return 'audience';
    return null;
  }

  function behaviour(candidate, audience, signals) {
    const problem = behaviourProblem(candidate, audience);
    if (problem) return problem;
    const value = candidate.value;
    const now = Date.now();
    for (const [attribute, override, field] of [
      ['new-days', 'new', 'createdAt'],
      ['renew-days', 'renewing', 'nextBillingDate'],
    ]) {
      const raw = value(attribute);
      if (raw === null || raw === '') continue;
      const days = Number(raw);
      if (overrides) {
        if (!overrides.has(override)) return attribute;
        continue;
      }
      const time = signals?.[field];
      if (!Number.isFinite(time)) return 'signal-unknown';
      if (attribute === 'new-days' && (time > now || time < now - days * 86400000)) return attribute;
      if (attribute === 'renew-days') {
        if (signals.cancelAt === undefined) return 'signal-unknown';
        if (signals.cancelAt !== null || time < now || time > now + days * 86400000) return attribute;
      }
    }
    for (const [attribute, field] of [['no-availability', 'availabilityEmpty'], ['no-stripe', 'stripeState']]) {
      if (value(attribute) !== 'true') continue;
      if (overrides) {
        if (!overrides.has(attribute)) return attribute;
        continue;
      }
      const signal = signals?.[field];
      if (attribute === 'no-availability') {
        if (typeof signal !== 'boolean') return 'signal-unknown';
        if (!signal) return attribute;
      } else {
        if (!['disconnected', 'ready', 'incomplete'].includes(signal)) return 'signal-unknown';
        if (signal !== 'disconnected') return attribute;
      }
    }
    return null;
  }

  function wireHistory(modal, entry, key, audience, path) {
    const reported = new Set();
    async function record(event) {
      if (!reported.has(event)) {
        reported.add(event);
        try {
          window.dispatchEvent(new CustomEvent('modal-campaign', {
            detail: { key, event, audience, path, at: new Date().toISOString() },
          }));
        } catch (_) {}
        try {
          if (Array.isArray(window.dataLayer)) {
            window.dataLayer.push({ event: 'modal_campaign', modal_key: key, modal_event: event, audience });
          }
        } catch (_) {}
      }
      try { return await modal.history.record(key, event); }
      catch (_) { return false; }
    }
    window.addEventListener('modal-close', (event) => {
      if (event.detail?.modal === entry.el) record('dismissed');
    });
    entry.el.addEventListener('click', (event) => {
      if (event.target?.closest?.('[data-modal-close]')) return;
      const control = event.target?.closest?.('a, button');
      if (control && entry.el.contains(control)) record('cta');
    });
    return record('shown');
  }

  async function choose(sourceUrl) {
    try {
      if (blocked()) return null;
      const modal = window.lumos.modal;
      if (resetRequested && typeof modal.history?.reset === 'function') {
        try { await modal.history.reset(); } catch (_) {}
      }
      const audience = await modal.audience();
      if (!Object.hasOwn(AUDIENCES, audience) || blocked()) return null;
      const doc = await modal.source(sourceUrl);
      if (!doc || blocked()) return null;
      const path = currentPath();
      const candidates = [];
      for (const row of doc.querySelectorAll('.w-dyn-item[data-popup-campaign]')) {
        const skip = (reason) => { debug(row.getAttribute('data-popup-campaign') || '', reason); return null; };
        const candidate = campaign(row, audience, path, skip);
        if (candidate) {
          if (await modal.history.hasShown(candidate.key) === false) {
            const problem = behaviourProblem(candidate, audience);
            if (problem) debug(candidate.key, problem);
            else candidates.push(candidate);
          }
          else debug(candidate.key, 'seen');
        }
        if (blocked() || currentPath() !== path) return null;
      }
      const needs = {
        availability: candidates.some((entry) => entry.value('no-availability') === 'true'),
        stripe: candidates.some((entry) => entry.value('no-stripe') === 'true'),
      };
      const requiresSignals = candidates.some((entry) => ['new-days', 'renew-days'].some((name) => {
        const value = entry.value(name); return value !== null && value !== '';
      })) || needs.availability || needs.stripe;
      let signals;
      if (requiresSignals && !overrides) {
        try { signals = await modal.signals(needs); } catch (_) {}
      }
      const unseen = candidates.filter((entry) => {
        const reason = behaviour(entry, audience, signals);
        debug(entry.key, reason);
        return reason === null;
      });
      unseen.sort((a, b) => b.priority - a.priority || (b.start > a.start ? 1 : b.start < a.start ? -1 : 0));
      const selected = unseen[0];
      if (!selected || blocked()) return null;
      const entry = await modal.load(sourceUrl, selected.key, { open: false });
      if (!entry || blocked() || currentPath() !== path || selected.start > Date.now() || selected.end < Date.now() || behaviour(selected, audience, signals)) return null;
      entry.open();
      if (entry.el.open !== true) return null;
      await wireHistory(modal, entry, selected.key, audience, path);
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
