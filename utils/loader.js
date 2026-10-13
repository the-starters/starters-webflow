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
