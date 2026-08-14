# V3 Algolia environment wiring

Status: Prepared, not released

`v3/algolia-environment.js` must load before the deferred wf-algolia bundle and
`quiz-results.js`. It selects public search credentials and primary indexes
from the exact host. Managed clients, including quiz Starter recommendations,
consume this resolved configuration. They do not accept a mode or index from
query parameters, local storage, Memberstack custom fields, page forms, DOM
attributes, page globals, or Xano responses.

## Exact host contract

| Host | Environment | Starter index | Opportunity index |
| --- | --- | --- | --- |
| `the-starters-3-0.webflow.io` | `test` | `Freelancers3.0-staging-test` | `opportunities_v3_test` |
| `thestarters.com` | `production` | `Freelancers3.0-production` | `opportunities_v3_production` |
| `www.thestarters.com` | `production` | `Freelancers3.0-production` | `opportunities_v3_production` |

The TEST and production search keys must differ. Each key must have search-only
access to its two environment indexes and the shared public `LearnContent`
index. The resolver rejects any index mapping
that differs from the table, shared managed indexes, and any managed index name
that contains a `dev` segment.

## Required markup

Mark the one wf-algolia client script:

```html
<script
  defer
  data-starters-v3-algolia-client
  data-app-id=""
  data-search-key=""
  src="https://cdn.jsdelivr.net/npm/@candid-leap/wf-algolia@1/dist/index.js"
></script>
```

Provide the independent shared LearnContent credentials on a separate client
owner:

```html
<script
  type="application/json"
  data-starters-shared-algolia-client
  data-app-id="SHARED_PUBLIC_APP_ID"
  data-search-key="SHARED_LEARNCONTENT_SEARCH_KEY"
></script>
```

Mark each managed browse section. Keep existing wf-algolia attributes and add
only the resource attribute:

```html
<div
  wf-algolia-element="browse"
  wf-algolia-index=""
  data-starters-v3-algolia-resource="starters"
></div>

<div
  wf-algolia-element="browse"
  wf-algolia-index=""
  data-starters-v3-algolia-resource="opportunities"
></div>
```

Do not mark the shared `LearnContent` index. The resolver reads only the
separate shared client owner into
`window.starterQuizLearnContentAlgoliaConfig`. The quiz Learn search uses only
that dedicated value while the managed resolver is active, so it cannot fall
back to a TEST or production managed key. Keep the shared key search-only and
restricted to `LearnContent`.

## Release prerequisites

- Create `opportunities_v3_test`, `Freelancers3.0-production`, and
  `opportunities_v3_production`.
- Create distinct restricted TEST and production search-only keys. Permit each
  key to search only its two managed environment indexes plus shared public
  `LearnContent`.
- Keep the independent shared key restricted to `LearnContent` and distinct
  from both managed keys.
- Add the public host configuration to a GitHub-owned config file. Load it
  immediately before `v3/algolia-environment.js`.
- Run the Xano configure endpoints for each environment after the matching
  restricted write keys are present.
- Publish the five staged Xano Algolia units only after masked configuration
  readback passes.
- Reindex the exact TEST and production cohorts separately. Reconcile stable-ID
  digests and stop on the first cross-environment record.
- Merge, tag, purge jsDelivr, install the resolver before wf-algolia, publish
  staging first, and verify loaded bytes and runtime attributes.

Unknown hosts, missing values, an unknown managed resource, shared keys, shared
indexes, and legacy dev indexes replace managed credentials with the independent
shared LearnContent credentials and remove managed index attributes. This is the
intended fail-closed state.
