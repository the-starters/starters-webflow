// Docs: README.md → "Shared Webflow component embeds", entry
// global-embeds/modal/calendly-fit.js. This header owns the full contract.
//
// @release v1.59.740
//
// Calendly fit: sizes an inline Calendly embed to the height of what Calendly is
// actually showing, so a parent that centers it (flex, align-items: center) can
// center the calendar instead of leaving it top-aligned above empty space.
// Built for the paid landing page's book-a-call modal; works on any page.
//
// OPT-IN
//   Add data-calendly-fit to the Calendly widget element
//   (<div class="calendly-inline-widget" data-url="…">) or to a wrapper around
//   it. Widgets without it are never touched.
//
// HOW IT WORKS
//   Calendly's iframe posts {event: "calendly.page_height", payload: {height}}
//   to the page whenever its content changes height (date picker, time list,
//   form). For a message from https://calendly.com, the iframe whose
//   contentWindow sent it is found inside an opted-in element, and its parent
//   (the widget) gets that height in px, never more than its container:
//     - container = the opted-in wrapper when the attribute is on a wrapper,
//       or the widget's parent when it is on the widget itself.
//   The widget's own inline height (the embed snippet's "height:700px" or the
//   Designer's 100%) is the starting state and is put back before each
//   measurement, so the container can be read at its natural size.
//   The widget gets data-calendly-fit-height="<px>" once sized.
//
// Console output is staging-only (README → "Staging-only console diagnostics").

(function () {
  if (window.__startersCalendlyFitInit) return;
  window.__startersCalendlyFitInit = true;

  const RELEASE = 'v1.59.740';
  const ORIGIN = 'https://calendly.com';
  const OPT_IN = 'data-calendly-fit';
  const BASE = 'data-calendly-fit-base';
  const SIZED = 'data-calendly-fit-height';

  const diagnostics = () => window.STARTERS_DEBUG === true ||
    ['localhost', '127.0.0.1'].includes(window.location.hostname) ||
    /(^|\.)webflow\.io$/.test(window.location.hostname) ||
    /(^|\.)trycloudflare\.com$/.test(window.location.hostname);
  const log = (...args) => { if (diagnostics()) console.info('[calendly-fit]', ...args); };

  function parseHeight(value) {
    const height = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(height) && height > 0 ? height : null;
  }

  /** {frame, widget, container} for the iframe that posted, or null. */
  function locate(source) {
    const optedIn = document.querySelectorAll('[' + OPT_IN + ']');
    for (let i = 0; i < optedIn.length; i += 1) {
      const holder = optedIn[i];
      const frames = holder.querySelectorAll('iframe');
      for (let j = 0; j < frames.length; j += 1) {
        if (frames[j].contentWindow !== source) continue;
        const widget = frames[j].parentElement;
        if (!widget) return null;
        const container = holder === widget ? widget.parentElement : holder;
        return { widget, container };
      }
    }
    return null;
  }

  function fit(event) {
    if (event.origin !== ORIGIN) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.event !== 'calendly.page_height') return;
    const height = parseHeight(data.payload && data.payload.height);
    if (height === null) return;
    const found = locate(event.source);
    if (!found) return;
    const { widget, container } = found;

    if (!widget.hasAttribute(BASE)) widget.setAttribute(BASE, widget.style.height || '');
    widget.style.height = widget.getAttribute(BASE);
    const max = container ? container.clientHeight : 0;
    const next = max > 0 ? Math.min(height, max) : height;
    widget.style.height = next + 'px';
    widget.setAttribute(SIZED, String(next));
    log('sized widget to', next, 'px (Calendly asked for', height, ', container', max, ')');
  }

  window.addEventListener('message', fit);
  window.startersCalendlyFit = { release: RELEASE };
})();
