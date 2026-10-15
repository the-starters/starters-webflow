function loadEnvScript({ name = "script", staging, live, type = "module", productionCanary }) {
  if (Object.prototype.hasOwnProperty.call(arguments[0], "productionCanary")) {
    return loadCanaryEnvScript({ name, staging, live, type, productionCanary });
  }
  const isStaging = window.location.host.includes("webflow.io");
  const src = isStaging ? staging : live;
  const el = document.createElement("script");
  el.setAttribute("src", src);
  el.setAttribute("type", type);
  el.addEventListener("load", () => {
    console.log(`Loaded ${name} (${isStaging ? "staging" : "live"}) 🤙`);
  });
  el.addEventListener("error", (e) => {
    console.log(`Error loading ${name}`, e);
  });
  document.body.appendChild(el);
}

// Opt-in source selection only. The backend remains the authorization boundary.
// Legacy callers above keep their immediate append and existing return value.
function loadCanaryEnvScript({ name, staging, live, type, productionCanary }) {
  const canary = productionCanary || {};
  const memberId = canary.memberId;
  const candidate = canary.src;
  const key = JSON.stringify([staging, live, type,
    typeof memberId === "string" ? memberId : null,
    typeof candidate === "string" ? candidate : null]);
  const loads = loadCanaryEnvScript.loads || (loadCanaryEnvScript.loads = new Map());
  const previous = loads.get(name);
  if (previous) {
    if (previous.key !== key) {
      return Promise.reject(new Error(`Conflicting loadEnvScript configuration for ${name}`));
    }
    return previous.promise;
  }

  const promise = new Promise((resolve, reject) => {
    function append(src) {
      const el = document.createElement("script");
      el.setAttribute("src", src);
      el.setAttribute("type", type);
      el.async = false;
      el.addEventListener("load", () => resolve(el));
      el.addEventListener("error", () => reject(new Error(`Failed to load ${name}`)));
      document.body.appendChild(el);
    }

    if (window.location.host.includes("webflow.io")) {
      append(staging);
      return;
    }

    let valid = typeof memberId === "string" && /^mem_[A-Za-z0-9_]+$/.test(memberId);
    try {
      const url = new URL(candidate);
      valid = valid && typeof candidate === "string" && candidate === candidate.trim() &&
        url.protocol === "https:" && !url.username && !url.password;
    } catch (_) {
      valid = false;
    }
    if (!valid) {
      append(live);
      return;
    }

    let settled = false;
    let timer;
    function select(src) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      append(src);
    }
    timer = window.setTimeout(() => select(live), 3000);
    try {
      const sdk = window.$memberstackDom;
      if (!sdk || typeof sdk.getCurrentMember !== "function") {
        select(live);
        return;
      }
      // The installed shared-read wrapper deduplicates only in-flight reads.
      // Do not retain its member result here for a later script/account.
      Promise.resolve(sdk.getCurrentMember()).then(
        (response) => select(response && response.data && response.data.id === memberId ? candidate : live),
        () => select(live),
      );
    } catch (_) {
      select(live);
    }
  });
  loads.set(name, { key, promise });
  return promise;
}

// A dependency group selects one source cohort for this page load. It never
// upgrades an ordinary group or mixes ordinary scripts into a started canary.
function loadEnvScriptGroup({ name, scripts, type = "module", productionCanary } = {}) {
  function httpsSource(value) {
    if (typeof value !== "string" || value !== value.trim()) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch (_) { return false; }
  }

  if (typeof name !== "string" || !name.trim() || !Array.isArray(scripts) ||
      !scripts.length || (type !== "module" && type !== "text/javascript") ||
      scripts.some(script => !script || typeof script.name !== "string" ||
        !script.name.trim() || !httpsSource(script.staging) || !httpsSource(script.live)) ||
      new Set(scripts.map(script => script.name)).size !== scripts.length) {
    return Promise.reject(new Error("Invalid loadEnvScriptGroup configuration"));
  }
  // Snapshot all URLs before any asynchronous work. Callers cannot change a
  // remaining dependency or canary identity while an earlier script loads.
  const entries = scripts.map(script => ({ name: script.name, staging: script.staging,
    live: script.live, canary: script.canary }));
  const memberId = productionCanary && productionCanary.memberId;
  let key;
  try { key = JSON.stringify([type, entries, productionCanary]); }
  catch (_) { return Promise.reject(new Error("Invalid loadEnvScriptGroup configuration")); }
  const groups = loadEnvScriptGroup.loads || (loadEnvScriptGroup.loads = new Map());
  const previous = groups.get(name);
  if (previous) {
    return previous.key === key ? previous.promise :
      Promise.reject(new Error(`Conflicting loadEnvScriptGroup configuration for ${name}`));
  }
  const validCanary = typeof memberId === "string" && /^mem_[A-Za-z0-9_]+$/.test(memberId) &&
    entries.every(script => httpsSource(script.canary));

  function currentMemberMatches() {
    return new Promise(resolve => {
      let settled = false;
      let timer;
      function finish(matches) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(matches);
      }
      timer = window.setTimeout(() => finish(false), 3000);
      try {
        const sdk = window.$memberstackDom;
        if (!sdk || typeof sdk.getCurrentMember !== "function") return finish(false);
        Promise.resolve(sdk.getCurrentMember()).then(
          response => finish(Boolean(response && response.data && response.data.id === memberId)),
          () => finish(false),
        );
      } catch (_) { finish(false); }
    });
  }
  function append(script, cohort) {
    return new Promise((resolve, reject) => {
      const element = document.createElement("script");
      element.setAttribute("src", script[cohort]);
      element.setAttribute("type", type);
      element.async = false;
      element.addEventListener("load", () => resolve(element));
      element.addEventListener("error", () => reject(new Error(`Failed to load ${name}/${script.name}`)));
      document.body.appendChild(element);
    });
  }
  const promise = Promise.resolve().then(async () => {
    const cohort = window.location.host.includes("webflow.io") ? "staging" :
      validCanary && await currentMemberMatches() ? "canary" : "live";
    const loaded = [];
    for (let index = 0; index < entries.length; index++) {
      if (cohort === "canary" && index > 0 && !await currentMemberMatches()) {
        throw new Error(`Canary member identity could not be verified for ${name}/${entries[index].name}`);
      }
      loaded.push(await append(entries[index], cohort));
    }
    return loaded;
  });
  groups.set(name, { key, promise });
  return promise;
}
