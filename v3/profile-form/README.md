# Profile form browser ownership

The native Webflow forms, fields, success states, error states, and layout remain authored in Webflow.
This directory owns browser logic shared by Build Profile and Starter Edit Profile.

## Inline extraction candidate

`shared-foundation.js` and `incremental-dropdowns.js` are behavior-preserving extractions from the
authenticated published pages. Route-specific extracted controllers remain in `v3/build-profile/`
and `v3/starter-edit-profile/`. Deliverable files normalize trailing whitespace and excess terminal
newlines. The manifest records separate immutable live identities and normalized candidate identities,
plus the exact inverse whitespace transformation used to reconstruct each captured live body.

`inline-extraction-cutover-candidate.json` binds each source body to its authenticated published body
length, SHA-256, complete-embed SHA-256, script index, component instance, and node or complete
custom-code location. `inline-extraction-loaders.CANDIDATE.html` serializes one ordered grouped loader
template per route. The template wrappers keep this candidate file inert. Neither file authorizes an
install or publish.

The cutover is atomic per route. At that route's shared-foundation anchor, replace the exact
embed with the complete inner loader group. Then empty only the other audited inline bodies listed in
the route manifest. Do not install one extracted loader at each former node. The live extracted bodies
run during HTML parsing, before the existing deferred photo, company, portfolio, work-date, counter,
bio, grouped-select, and diagnostic controllers. A per-node deferred replacement would move some
extracted boots after those existing controllers. The grouped anchor preserves the supported
controller order. On Edit and Consult, the extracted group registers before the preserved post-anchor
profile controllers. Full Profile has one controlling exception before the anchor: pinned index 30
`starters-webflow@v1.56.14/profile-image-auth-shim.js` installs the authenticated image interception
first. The grouped extracted controllers execute at index 66, then the remaining loaders keep their
DOM order. The later index 77 `@latest/profile-image-auth-shim.js` is an intentional no-op because
the index 30 script already set `window.__tsProfileImageAuthShim`.
`profile-image-auth-shim-v1.56.14.capture.txt` is the exact 16,265-byte Git-tag capture used to
execute and hash that controlling historical asset in tests. It is evidence, not a new CDN loader.

The shared component is used by all three routes, so a future operator must apply and read back the
route-instance binding recorded in the manifest. Do not turn one route group into a site-wide or
cross-route component edit. Replace only an anchor or removal whose exact complete-location hash
matches the recorded before hash. Read every complete saved location back before an authorized
publish. Existing profile-photo, Step 3 company, Step 4 portfolio, and later loaders stay unchanged.

The extraction does not move the form into JavaScript. It does not change the separate Step 3 company
owner or Step 4 portfolio owner. A future `wf-xano` conversion requires a separate declarative contract
and must not be combined with this behavior-preserving ownership cutover.

## Verification

Run:

```sh
node --test v3/profile-form/inline-extraction-contract.test.js
```

The executable suite checks immutable live identities and normalized candidate identities against an
oracle outside the cutover manifest. It reconstructs each live body through the recorded whitespace-only
transformation, parses the loader templates, and rejects URL, defer, order, duplicate, late-anchor,
missed-removal, existing-loader, and route-owner drift. It executes each complete route sequence,
including every existing profile controller at its captured position, in one browser-like context and
pins the exact boot and handler registration order. It also proves one native-form handler owner and
checks the shared empty-profile model,
country/state/city transitions, local-versus-member draft precedence, canonical edit hydration, the
normalized final Build Profile payload, and that the controllers do not create a form element.
