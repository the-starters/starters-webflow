# Opportunity detail role feeds

The shared opportunity CMS template currently starts both wf-xano feeds before
Memberstack hides the other role's section. A Brand viewer therefore calls
`opp30:starter/applications/mine` and gets its designed missing-Starter rejection.
Keep both renderers. Use the library's existing `wf-xano-defer` contract and the
page controller's existing plan/ownership checks to start only the correct feed.

The controller ([`../../opportunities-3.0.js`](../../opportunities-3.0.js))
selects the exact canonical `wf-xano-source` attribute, falling back to the same
substring rule its render-ownership guard uses, and only ever matches a root that
carries `wf-xano-defer="true"`. It does not require new role containers or alter
Memberstack gating. Starter activation follows the plan gate; Brand activation
additionally follows the successful owner-scoped probe. The existing library
queue supports either script load order. A root that has not opted out of
automatic boot is never re-initialized, so the released controller is inert on
the page until step 3 below adds the attribute.

## Ordered release

1. Review, test, merge and release the controller through the next CDN semver tag.
   Purge the alias and verify served bytes before changing authored attributes.
2. Use the official headless Webflow element tools on site
   `69c573f20f82bd0f3384032c`, page `6a0ea3a1cfb6c29eb25f147c`.
   Snapshot the complete attributes and CMS bindings on both roots first.
   Confirm the page serves `wf-xano` v0.28.0 or newer: older bundles ignore
   `wf-xano-defer`, so deferring the roots there would stop both feeds outright.
3. Add only `wf-xano-defer="true"` to Starter root
   `9796c2ce-a8a5-08cb-924d-96dcf6b584e2` and Brand root
   `70df7e66-a489-dad4-ba3d-70a833aa4ba9`. Read back both roots and compare every
   unrelated attribute and binding, especially CMS-bound opportunity IDs.
4. A Webflow publication publishes the whole site and other pending changes.
   It is a separate production boundary; do not infer authority from a CDN
   release. Publish only with applicable authorization and preservation checks.
5. Verify actual served attributes, then role-correct browser requests, output,
   reload behavior and screenshots. Repository tests alone do not close this.
   A console `[opp30] detail feed: no deferred wf-xano root for role <role>`
   line means the controller found no matching deferred root, so that role's
   feed never started — check the authored `wf-xano-source` and
   `wf-xano-defer` values.

Do not defer the roots before the controller release is verified: older code
does not activate deferred detail feeds. Do not remove templates, loader/empty
states, Memberstack attributes, or CMS parameter bindings. No data repair or
endpoint change is involved. The merged `/opportunities` feed stays unchanged.

## Acceptance and rollback

- Owning Brand: all expected applicants render; no Starter-feed request.
- Applied Starter: their application card renders; no Brand-feed request.
- Unapplied Starter: the authored empty state renders; no Brand-feed request.
- Foreign Brand and free Brand: existing authorization/redirect behavior remains.
- A transient owner-probe failure leaves owner controls hidden and the Brand
  feed uninitialized until a successful manual reload. This is not proof of an
  empty applicants list. Verify this path with fake transport; do not create a
  production outage for the check.
- Confirm both script load orders, reloads, and unchanged merged feed behavior.
- No application, messaging, hiring, or opportunity mutation is needed for proof.

If rolling back the controller after deferral, remove only the added
`wf-xano-defer` attribute from each root, read both complete attribute inventories
back, and publish while the new controller is still served. Never resend the
saved attribute lists: the CMS-bound `wf-xano-param-opportunity_id` may read as
null, which cannot reconstruct its binding. Verify resolved opportunity IDs and
request parameters on more than one published CMS item. Removing deferral
restores the previous auto-boot behavior (including the known unwanted request).
Verify feed activation before rolling back CDN code. Never leave deferred roots
with the old controller. Record publication scope and readbacks.

Current status: local candidate only; no Webflow attributes changed or published.
Focused regression on this candidate: three new activation cases fail against
the base controller; the command below reports `tests 183 / pass 183 / fail 0`
(181 top-level tests plus two nested subtests). Local browser fixtures use fake
Xano/Memberstack transports and a wf-xano stand-in. These results do not
establish production runtime acceptance.

```sh
node --test opportunities-3.0-auth.test.js
```
