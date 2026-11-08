(function () {
  const ENABLED_HOSTS = ['the-starters-3-0.webflow.io'];
  if (!ENABLED_HOSTS.includes(window.location.hostname)) return;
  if (window.__startersModalAudienceInit) return;
  window.__startersModalAudienceInit = true;

  let result;
  let member = null;
  let signalResult;
  function resolveAudience() {
    return new Promise((resolve) => {
      let finished = false;
      let poll;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        clearTimeout(poll);
        resolve(value);
      };
      const deadline = setTimeout(() => finish(null), 3000);
      (function check() {
        if (finished) return;
        try {
          const memberstack = window.$memberstackDom;
          const guard = window.StartersV3RouteGuard;
          if (typeof memberstack?.getCurrentMember !== 'function' || typeof guard?.memberRole !== 'function') {
            poll = setTimeout(check, 50);
            return;
          }
          Promise.resolve(memberstack.getCurrentMember()).then((response) => {
            if (finished) return;
            try {
              if (response?.data === null) return finish('signed-out');
              if (!response?.data?.id) return finish(null);
              member = response.data;
              const role = guard.memberRole(member);
              finish(['brand-free', 'brand-paid', 'talent'].includes(role) ? role : null);
            } catch (_) {
              finish(null);
            }
          }, () => finish(null));
        } catch (_) {
          finish(null);
        }
      })();
    });
  }

  function audience() {
    if (!result) result = resolveAudience();
    return result;
  }

  const XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io';
  const SCHEDULING_BASE = XANO_ORIGIN + '/api:tCpV3oqd';
  const STRIPE_STATUS = XANO_ORIGIN + '/api:KZf7nFnk/stripe_connect/status/v3';

  function bounded(operation) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, 3000);
    });
    return Promise.race([Promise.resolve().then(() => operation(controller.signal)).catch(() => null), deadline])
      .finally(() => clearTimeout(timer));
  }

  async function scheduling(path, method, data, signal) {
    if (signal.aborted) throw new Error('Signal timed out');
    const fetch = window.__tsSchedulingAuthFetch || window.xanoAuthFetch;
    if (typeof fetch !== 'function') throw new Error('Shared scheduling auth unavailable');
    const query = method === 'GET' ? '?' + new URLSearchParams(data) : '';
    const response = await fetch(SCHEDULING_BASE + path + query, {
      method, signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify(data) } : {}),
    });
    if (!response.ok || signal.aborted) throw new Error('Scheduling signal unavailable');
    return response.json();
  }

  async function availability(signal) {
    const starter = await scheduling('/starter/get_by_memberstack/v3', 'POST', { member_id: member.id }, signal);
    if (!starter?.nylas_grant_id) return null;
    const configs = await scheduling('/nylas_configurations/get_all/v3', 'POST', { grant_id: starter.nylas_grant_id }, signal);
    if (!Array.isArray(configs)) return null;
    const active = configs.filter((config) => config?.active === true);
    if (!active.length || active.some((config) => typeof config.config_id !== 'string' || !config.config_id)) return null;
    // Match the dashboard's 14-day slots preview, without its error-to-empty fallback.
    const start = Math.floor(Date.now() / 1000);
    const end = start + 14 * 86400;
    const results = await Promise.all(active.map(async (config) => {
      try {
        const response = await scheduling('/scheduler/get_availability/v3', 'GET', {
          grant_id: starter.nylas_grant_id, configuration_id: config.config_id,
          start_time: String(start), end_time: String(end), region: 'us',
        }, signal);
        if (!Array.isArray(response?.time_slots)) return null;
        if (response.time_slots.some((slot) => !Number.isFinite(slot?.start_time) ||
          !Number.isFinite(slot?.end_time) || slot.end_time <= slot.start_time)) return null;
        return !response.time_slots.some((slot) => slot.start_time >= start && slot.start_time < end);
      } catch (_) { return null; }
    }));
    if (results.includes(false)) return false;
    return results.includes(null) ? null : true;
  }

  async function stripe(signal) {
    if (typeof window.getXanoAuthToken !== 'function') return null;
    // The Stripe Connect controller uses this same shared token and status endpoint.
    const token = await window.getXanoAuthToken();
    if (!token || signal.aborted) return null;
    const response = await window.fetch(STRIPE_STATUS, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: '{}',
    });
    if (!response.ok || signal.aborted) return null;
    const status = await response.json();
    if (typeof status?.connected !== 'boolean' || typeof status?.charges_enabled !== 'boolean' ||
      (!status.connected && status.charges_enabled)) return null;
    return !status.connected ? 'disconnected' : status.charges_enabled ? 'ready' : 'incomplete';
  }

  async function resolveSignals(needs) {
    const role = await audience();
    const out = { createdAt: null, nextBillingDate: null, cancelAt: undefined, availabilityEmpty: null, stripeState: null };
    if (!member || !role || role === 'signed-out') return out;
    const dates = window.StartersPlanDates;
    if (typeof dates?.toDate === 'function' && typeof dates?.pickConnection === 'function') {
      const time = (value) => dates.toDate(value)?.getTime() ?? null;
      out.createdAt = time(member.createdAt);
      const payment = dates.pickConnection(member)?.payment;
      out.nextBillingDate = time(payment?.nextBillingDate);
      if (payment) {
        const cancel = payment.cancelAtDate;
        out.cancelAt = cancel === undefined || cancel === null || cancel === '' ? null : time(cancel) ?? undefined;
      }
    }
    if (role === 'talent') {
      const [empty, state] = await Promise.all([
        needs.availability ? bounded(availability) : null,
        needs.stripe ? bounded(stripe) : null,
      ]);
      out.availabilityEmpty = empty;
      out.stripeState = state;
    }
    return out;
  }

  function signals(needs = {}) {
    if (!signalResult) signalResult = resolveSignals(needs);
    return signalResult;
  }

  function startInstall() {
    const started = Date.now();
    (function install() {
      const modal = window.lumos?.modal;
      if (typeof modal?.init === 'function') {
        modal.audience = audience;
        modal.signals = signals;
      }
      else if (Date.now() - started < 4000) setTimeout(install, 50);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startInstall, { once: true });
  else startInstall();
})();
