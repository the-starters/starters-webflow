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
access to its two environment indexes plus the shared public `LearnContent`
index. The resolver rejects any index mapping that differs from the table,
shared managed indexes, and any managed index name that contains a `dev`
segment.

## Public configuration contract

Load a GitHub-owned public configuration before the resolver. Use this shape;
the two index values in each environment must match the exact host table above.

```html
<script>
  window.__startersV3AlgoliaConfig = {
    test: {
      appId: '<public Algolia application ID>',
      searchKey: '<restricted TEST search-only key>',
      startersIndex: '<TEST Starter index from the host table>',
      opportunitiesIndex: '<TEST Opportunity index from the host table>',
    },
    production: {
      appId: '<public Algolia application ID>',
      searchKey: '<restricted production search-only key>',
      startersIndex: '<production Starter index from the host table>',
      opportunitiesIndex: '<production Opportunity index from the host table>',
    },
  }
</script>
```

Do not derive any value in this object from browser input. Keep write keys and
admin keys out of browser configuration.

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

Do not mark or rename the shared `LearnContent` index. wf-algolia version 1.0.4
creates one runtime client from the first `script[data-app-id]`, so each
host-owned search key must also have search-only access to `LearnContent`.
Managed quiz code reads the exact `LearnContent` index through
`getSharedSearchConfig('learnContent')`; it does not accept a legacy window or
DOM override while the resolver is active.

## Release prerequisites

- Create `opportunities_v3_test`, `Freelancers3.0-production`, and
  `opportunities_v3_production`.
- Create distinct restricted TEST and production search-only keys. Permit each
  key to search only its two managed environment indexes plus shared public
  `LearnContent`.
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
indexes, and legacy dev indexes remove the client credentials and managed index
attributes. On approved hosts, the unmarked `LearnContent` index and its UI stay
unchanged while the host-owned key supplies its search-only access.
