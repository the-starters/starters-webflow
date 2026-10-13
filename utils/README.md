# Environment script loader

`loadEnvScript({ name, staging, live, type })` selects `staging` on hosts containing
`webflow.io`, and `live` elsewhere. `name` defaults to `script`, and `type` defaults
to `module`. Without the optional configuration below, it appends immediately and
returns `undefined`, as before.

## Production canary source selection

An explicitly configured `productionCanary: { memberId, src }` enables a bounded
authenticated member read on non-staging hosts. Use one stable Memberstack member
ID, an HTTPS candidate script URL, a unique `name`, and an immutable `live` URL.
Load `utils/memberstack-shared-reads.js` after Memberstack and before this call;
it shares concurrent reads without caching a settled member. Never use a query
parameter or browser storage to select the member or source.

Only `getCurrentMember()` resolving with an exact `response.data.id` match selects
the candidate. Missing SDK, malformed configuration or response, an anonymous or
different member, rejection, a thrown error, or a three-second timeout selects
`live`. A late member response cannot append another script. Staging selects its
configured source without a member read. This chooses browser code only; server
authorization and rollout gates still apply independently.

The optional path returns a Promise that resolves with the script element after
its load event, or rejects on a script load error. Classic scripts use
`async=false`. Await that Promise before a dependent load; independent member
reads can settle in either order. Repeating the same name and configuration
returns the same Promise and appends once. Reusing that name with a different
configuration rejects explicitly. A failed script does not fall back by appending
a second controller. Source choice lasts for that page load; a separately named
load reads the current member again rather than reusing the settled member.

Keep the Webflow block thin: load a reviewed immutable version of this helper,
then call it after dependencies are ready with static reviewed source URLs.
Pass `type: 'text/javascript'` for controllers that define classic globals. Handle
the returned rejection through the page's normal script-load error reporting.
Do not create a new repository tag containing candidate application code while
production still loads that code through `@latest`; install and verify its exact
production pin first.
