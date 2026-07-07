function loadEnvScript({ name = "script", staging, live, type = "module" }) {
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
