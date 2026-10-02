## Summary

<!-- What changes and why. Link the owning checklist. -->

## 🚦 Release safety (soft launch: V3 live, V2 redirects to V3)

V3 is the only live product. V2 is not a fallback. Fill in each row, or write "n/a" with a reason.
Full rules: workspace file `agent-workflows/soft-launch-release-safety.md`.

| Item | Answer |
| --- | --- |
| Blast radius (pages, roles, endpoints, tasks, providers) |  |
| Rollback target and exact action |  |
| Failsafe (guard, flag, allowlist, kill switch, inactive task) |  |
| Local proof |  |
| Staging proof |  |
| Isolated production proof |  |
| Full production canary (role and test account) |  |
| V2 redirect impact (old links, query strings, auth loops, V2 automations, callbacks) |  |
| Watch window and signals (PostHog, Xano errors, task runs, providers) |  |

## ✅ Checklist

- [ ] No secrets, tokens, or webhook URLs in the diff.
- [ ] Tests pass locally.
- [ ] Staging proof on `the-starters-3-0.webflow.io` through `@main` (env-switch loader).
- [ ] Prod pin in `utils/loader.js` moves only after staging proof. Previous tag recorded as rollback.
- [ ] After tag: jsDelivr purged and served file content verified (not only HTTP status).
- [ ] Published source scanned for `api.airtable.com`, `hook.us1.make.com`, and Airtable PAT patterns.
- [ ] Any Webflow `publish_site` is treated as a whole-site production publish.
