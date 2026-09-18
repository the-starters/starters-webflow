# Opportunity detail role feeds

The shared opportunity CMS template currently starts both wf-xano feeds before
Memberstack hides the other role's section. A Brand viewer therefore calls
`opp30:starter/applications/mine` and gets its designed missing-Starter rejection.
Keep both renderers. Use the library's existing `wf-xano-defer` contract and the
page controller's existing plan/ownership checks to start only the correct feed.

The controller selects the exact canonical `wf-xano-source` attribute. It does
not require new role containers or alter Memberstack gating. Starter activation
follows the plan gate; Brand activation additionally follows the successful
owner-scoped probe. The existing library queue supports either script load order.
Already initialized roots remain idempotent under `WfXano.init(root)`.

## Ordered release

1. Review, test, merge and release the controller through the next CDN semver tag.
   Purge the alias and verify served bytes before changing authored attributes.
2. Use the official headless Webflow element tools on site
   `69c573f20f82bd0f3384032c`, page `6a0ea3a1cfb6c29eb25f147c`.
   Snapshot the complete attributes and CMS bindings on both roots first.
3. Add only `wf-xano-defer="true"` to Starter root
   `9796c2ce-a8a5-08cb-924d-96dcf6b584e2` and Brand root
   `70df7e66-a489-dad4-ba3d-70a833aa4ba9`. Read back both roots and compare every
   unrelated attribute and binding, especially CMS-bound opportunity IDs.
4. A Webflow publication publishes the whole site and other pending changes.
   It is a separate production boundary; do not infer authority from a CDN
   release. Publish only with applicable authorization and preservation checks.
5. Verify actual served attributes, then role-correct browser requests, output,
   reload behavior and screenshots. Repository tests alone do not close this.

Do not defer the roots before the controller release is verified: older code
does not activate deferred detail feeds. Do not remove templates, loader/empty
states, Memberstack attributes, or CMS parameter bindings. No data repair or
endpoint change is involved. The merged `/opportunities` feed stays unchanged.

## Acceptance and rollback

- Owning Brand: all expected applicants render; no Starter-feed request.
- Applied Starter: their application card renders; no Brand-feed request.
- Unapplied Starter: the authored empty state renders; no Brand-feed request.
- Foreign Brand and free Brand: existing authorization/redirect behavior remains.
- Confirm both script load orders, reloads, and unchanged merged feed behavior.
- No application, messaging, hiring, or opportunity mutation is needed for proof.

If rolling back the controller after deferral, first restore and publish the
exact saved root attributes while the new controller is still served. Removing
deferral restores the previous auto-boot behavior (including the known unwanted
request). Verify feed activation before rolling back CDN code. Never leave
deferred roots with the old controller. Record publication scope and readbacks.

Current status: local candidate only; no Webflow attributes changed or published.
Focused regression: the two activation cases fail on the original controller;
the candidate passes the complete 181-test authentication/controller suite.
