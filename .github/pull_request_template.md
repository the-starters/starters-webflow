## Summary

<!-- What changes and why. Link the owning checklist. -->

## 🚦 Release safety (soft launch: V3 live, V2 redirects to V3)

V3 is the only live product. V2 is not a fallback.
Full rules and tier scope: [soft-launch release safety](https://github.com/the-starters/internal-agent-ops/blob/main/workflows/soft-launch-release-safety.md).

**Tier:** T0 / T1 / T2 (pick one; when unsure, use T2)

- **T0** (copy, CSS, docs, tests, tooling, small CDN JS behind the pinned prod tag): fill in only the rollback row. Delete the other rows.
- **T1** (other front-end logic, unused new endpoint versions, inactive tasks): fill in every row. One canary is enough.
- **T2** (production rows, schema, live Xano publish, Webflow publish, tasks, email, payments, auth, redirects): fill in every row.

For T1 and T2, fill in each row, or write "n/a" with a reason.

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
