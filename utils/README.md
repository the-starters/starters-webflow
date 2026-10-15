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


## One cohort for dependent scripts

Use `loadEnvScriptGroup` when an ordinary/candidate mixture would break a group
of dependent controllers. Existing `loadEnvScript` calls keep their behavior.

```js
loadEnvScriptGroup({
  name: 'starter-calendar-owners',
  type: 'text/javascript',
  productionCanary: { memberId: 'mem_REVIEWED_MEMBER' },
  scripts: [
    { name: 'free', staging: 'https://cdn.example/stage/free.js',
      live: 'https://cdn.example/ordinary/free.js', canary: 'https://cdn.example/candidate/free.js' },
    { name: 'init', staging: 'https://cdn.example/stage/init.js',
      live: 'https://cdn.example/ordinary/init.js', canary: 'https://cdn.example/candidate/init.js' },
    { name: 'section', staging: 'https://cdn.example/stage/section.js',
      live: 'https://cdn.example/ordinary/section.js', canary: 'https://cdn.example/candidate/section.js' },
  ],
}).catch(reportScriptLoadError);
```

Replace these illustrative URLs and member with reviewed static values; use
immutable production and candidate references. Group/dependency names must be
nonempty, dependency names unique, and staging/live URLs HTTPS. Invalid group
structure rejects before loading. Missing or invalid canary configuration chooses
the ordinary cohort on production. Staging uses every `staging` source without
a member read.

Production selects a cohort once with an exact current-member match and a
three-second timeout. An initial mismatch, unknown member, missing SDK, thrown
error, rejection, or timeout selects every ordinary source. Later SDK recovery
cannot upgrade that group. For a selected canary, the helper makes another bounded
current-member read before each remaining dependency. A missing, different, failed,
or timed-out identity rejects the group without appending that dependency or any
ordinary fallback. A late response cannot restart it. Already executed scripts
cannot be unloaded; their own auth/session guards and backend authorization remain
required. This helper selects code only.

The helper snapshots configuration, appends one script at a time with
`async=false`, and awaits its load event before the next identity check/append.
The returned Promise resolves with the loaded elements. Load failure stops the
group; it does not append a second source. Script execution order does not imply
completion of internal asynchronous controller reads.

One group name owns one ordered configuration for the page. Identical repeats
return the same Promise during and after completion or failure; conflicting
sources/order/member/type reject. A failed group needs a fresh page load after
recovery. Do not also load its dependencies with direct tags or separate
`loadEnvScript` calls. Preserve Memberstack/shared-read dependency order and use
one reviewed immutable helper that includes this API. A previously released
helper without the API cannot run a group footer.
