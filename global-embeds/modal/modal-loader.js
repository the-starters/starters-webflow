(function () {
  const ENABLED_HOSTS = ['the-starters-3-0.webflow.io'];
  if (window.__startersModalLoaderInit) return;
  window.__startersModalLoaderInit = true;

  const DEFAULT_TIMEOUT = 4000;
  const pending = new Map();
  const styles = new Map();
  const system = () => window.lumos?.modal;
  const enabled = () => ENABLED_HOSTS.includes(window.location.hostname);
  const diagnostics = () => window.STARTERS_DEBUG === true ||
    ['localhost', '127.0.0.1'].includes(window.location.hostname) ||
    /(^|\.)webflow\.io$/.test(window.location.hostname) ||
    /(^|\.)trycloudflare\.com$/.test(window.location.hostname);

  function rewriteSrcset(value, source) {
    const candidates = [];
    let rest = value;
    while ((rest = rest.replace(/^[\s,]+/, ''))) {
      const token = rest.match(/^\S+/)[0];
      rest = rest.slice(token.length);
      const url = token.replace(/,+$/, '');
      let descriptor = '';
      if (!token.endsWith(',')) {
        const end = rest.indexOf(',');
        descriptor = (end < 0 ? rest : rest.slice(0, end)).trim();
        rest = end < 0 ? '' : rest.slice(end + 1);
      }
      candidates.push(new URL(url, source).href + (descriptor ? ' ' + descriptor : ''));
    }
    return candidates.join(', ');
  }

  function acquireStyle(href) {
    let record = styles.get(href);
    if (record) {
      record.users += 1;
      return record;
    }
    if (Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .some((link) => new URL(link.getAttribute('href'), window.location.href).href === href)) return null;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    record = { link, href, users: 1, committed: false };
    record.ready = new Promise((resolve, reject) => {
      link.onload = resolve;
      link.onerror = () => reject(new Error('Source stylesheet unavailable'));
    });
    styles.set(href, record);
    document.head.append(link);
    return record;
  }

  function releaseStyles(records, success) {
    for (const record of records) {
      record.users -= 1;
      if (success) record.committed = true;
      if (!record.users && !record.committed) {
        record.link.remove();
        styles.delete(record.href);
      }
    }
  }

  async function importDialog(source, key, target, options) {
    const controller = new AbortController();
    const records = [];
    let node;
    let opening = false;
    let timer;
    let success = false;
    const check = () => {
      if (controller.signal.aborted) throw new Error('Modal load timed out');
    };
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Modal load timed out'));
      }, timeoutMs);
    });
    try {
      const operation = (async () => {
        while (typeof system()?.init !== 'function') {
          check();
          await new Promise((resolve) => setTimeout(resolve, Math.min(50, timeoutMs)));
        }
        check();
        const response = await fetch(source.href, { signal: controller.signal, redirect: 'error' });
        check();
        if (!response.ok || (response.url && new URL(response.url).origin !== source.origin)) {
          throw new Error('Modal source unavailable');
        }
        const html = await response.text();
        check();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const matches = Array.from(doc.querySelectorAll('.modal_dialog[data-popup-source]'))
          .filter((el) => el.tagName === 'DIALOG' && el.getAttribute('data-popup-source') === key);
        if (matches.length !== 1) throw new Error('Expected one source dialog');
        const pageId = doc.documentElement.getAttribute('data-wf-page');
        const sheets = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))
          .map((link) => new URL(link.getAttribute('href'), source))
          .filter((url) => pageId && url.pathname.includes('.webflow.' + pageId + '.'));
        if (!sheets.length) throw new Error('Source page stylesheet missing');
        for (const sheet of sheets) {
          const record = acquireStyle(sheet.href);
          if (record) records.push(record);
        }
        await Promise.all(records.map((record) => record.ready));
        check();
        node = document.importNode(matches[0], true);
        node.querySelectorAll('script').forEach((script) => script.remove());
        for (const attr of ['open', 'data-script-initialized', 'data-preview']) node.removeAttribute(attr);
        node.setAttribute('data-modal-target', target);
        node.setAttribute('data-popup-loaded', key);
        for (const el of [node, ...node.querySelectorAll('[href], [src], [srcset]')]) {
          for (const attr of ['href', 'src']) {
            const value = el.getAttribute(attr);
            if (value && !value.startsWith('#')) el.setAttribute(attr, new URL(value, source).href);
          }
          if (el.hasAttribute('srcset')) el.setAttribute('srcset', rewriteSrcset(el.getAttribute('srcset'), source));
        }
        document.body.append(node);
        system().init();
        const entry = system().list[target];
        if (entry?.el !== node) throw new Error('Dialog registration failed');
        if (options.open) {
          opening = true;
          system().open(target);
        }
        return entry;
      })();
      const entry = await Promise.race([operation, timeout]);
      success = true;
      return entry;
    } catch (_) {
      if (node) {
        const entry = system()?.list?.[target];
        try {
          if (entry?.el === node && (opening || node.open)) entry.close();
          node.tl?.kill?.();
        } finally {
          if (entry?.el === node) delete system().list[target];
          node.remove();
        }
      }
      if (diagnostics()) console.warn('[modal-loader] Modal load failed');
      return null;
    } finally {
      clearTimeout(timer);
      releaseStyles(records, success);
    }
  }

  async function load(sourceUrl, key, options = {}) {
    if (!enabled()) return null;
    try {
      options = options || {};
      const source = new URL(sourceUrl, window.location.href);
      const target = options.as || key;
      if (source.origin !== window.location.origin || typeof key !== 'string' || !key ||
        typeof target !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(target) ||
        ['__proto__', 'constructor', 'prototype'].includes(target)) return null;
      const existing = Array.from(document.querySelectorAll('.modal_dialog'))
        .find((el) => el.getAttribute('data-modal-target') === target);
      if (existing) {
        system().init();
        const entry = system().list[target];
        if (entry?.el !== existing) return null;
        if (options.open) system().open(target);
        return entry;
      }
      if (pending.has(target)) {
        const entry = await pending.get(target);
        if (entry && options.open) system().open(target);
        return entry;
      }
      const task = importDialog(source, key, target, options);
      pending.set(target, task);
      try { return await task; }
      finally { pending.delete(target); }
    } catch (_) {
      return null;
    }
  }

  const started = Date.now();
  (function install() {
    if (typeof system()?.init === 'function') system().load = load;
    else if (Date.now() - started < DEFAULT_TIMEOUT) setTimeout(install, 50);
  })();
})();
