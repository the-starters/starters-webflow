(function () {
  const ENABLED_HOSTS = ['the-starters-3-0.webflow.io'];
  if (!ENABLED_HOSTS.includes(window.location.hostname)) return;
  if (window.__startersModalAudienceInit) return;
  window.__startersModalAudienceInit = true;

  let result;
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
              const role = guard.memberRole(response.data);
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

  function startInstall() {
    const started = Date.now();
    (function install() {
      const modal = window.lumos?.modal;
      if (typeof modal?.init === 'function') modal.audience = audience;
      else if (Date.now() - started < 4000) setTimeout(install, 50);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startInstall, { once: true });
  else startInstall();
})();
