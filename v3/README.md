# V3 browser scripts

## Scheduling auth

`scheduling-auth.js` owns the Bearer-token adapter for the V3 availability and
scheduling configuration calls. Webflow should load it with a small `defer`
script tag instead of carrying a duplicate copy in page head/footer code.

Current safety boundary:

- Runs only on `the-starters-3-0.webflow.io`.
- Does not change V2 or either V3 custom domain.
- Caches the Xano token and retries once after a `401`.
- Exposes `window.getXanoAuthToken` and `window.xanoAuthFetch` for page-owned
  code.
- Transparently wraps the two scheduling path families while legacy inline
  Webflow callers are migrated.

Maintenance rule: new `api:tCpV3oqd` scheduling calls should use
`window.xanoAuthFetch`. Keep endpoint scope explicit; do not turn this into a
blanket credential injector.

Run the focused test with:

```sh
node v3/scheduling-auth.test.js
```
