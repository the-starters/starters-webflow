# V3 Algolia environment wiring

Status: Prepared for GitHub source release; not installed in Webflow

`v3/algolia-environment.js` must load before the deferred wf-algolia bundle and
`quiz-results.js`. It selects public search credentials and primary indexes
from the exact host. Managed clients, including quiz Starter recommendations,
consume this resolved configuration. They do not accept a mode or index from
query parameters, local storage, Memberstack custom fields, page forms, DOM
attributes, page globals, or Xano responses.

## Exact host contract

| Host | Environment | Starter index | Starter replica prefix | Opportunity index |
| --- | --- | --- | --- | --- |
| `the-starters-3-0.webflow.io` | `test` | `Freelancers3.0-staging-test` | `Freelancers3.0-staging-test__` | `opportunities_v3_test` |
| `thestarters.com` | `production` | `Freelancers3.0-production` | `Freelancers3.0-production__` | `opportunities_v3_production` |
| `www.thestarters.com` | `production` | `Freelancers3.0-production` | `Freelancers3.0-production__` | `opportunities_v3_production` |

The TEST and production search keys must differ. Each key must have search-only
access to its two environment primary indexes, the five matching Starter sort
replicas, and the shared public indexes listed below. The resolver rejects any
index mapping that differs from the table, shared managed indexes, and any
managed index name that contains a `dev` segment.

The resolver maps the existing logical sort values `name-AtoZ`, `rate_asc`,
`rate_desc`, `published_asc`, and `published_desc` to replicas named with the
environment Starter prefix above. An unknown sort value blocks the managed
Algolia client. The empty relevance option stays empty.

The current site also uses these public, non-member-data indexes through shared
components. Both restricted browser keys must include search-only access to
them: `LearnContent`, `cancelled-consult-1`, `cancelled-consult-2`, and
`cancelled-hire-1`.

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

Mark exactly one wf-algolia client script. The resolver blocks all clients if
another script carries `data-app-id` or `data-search-key`:

```html
<script
  defer
  data-starters-v3-algolia-client
  data-app-id=""
  data-search-key=""
  src="https://cdn.jsdelivr.net/npm/@candid-leap/wf-algolia@1/dist/index.js"
></script>
```

Mark each new managed browse section. Keep existing wf-algolia attributes and
add only the resource attribute:

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

Do not mark or rename the four shared indexes. Every unmarked
`wf-algolia-index` must match `LearnContent`, `cancelled-consult-1`,
`cancelled-consult-2`, or `cancelled-hire-1` exactly. During the current V3
cutover, the resolver also treats the exact unmarked legacy index
`Freelancers3.0-dev` as the Starter resource and rewrites it to the host-owned
Starter index. It also rewrites the exact legacy `data-tab-count-for` value used
by Explore, and keeps both attributes resolver-managed on repeated boots. This
covers the sitewide Explore and Expert Card component attributes without a
broad Designer rewrite. Near matches and every other unmarked index still block
all clients. wf-algolia version 1.0.4 creates one
runtime client from the first `script[data-app-id]`, so each host-owned search
key must also have search-only access to the shared indexes.
Managed quiz code reads the exact `LearnContent` index through
`getSharedSearchConfig('learnContent')`; it does not accept a legacy window or
DOM override while the resolver is active.

## Webflow installation prerequisites

The GitHub-backed source can be merged, tagged, and served through jsDelivr
before these prerequisites are complete. Do not install the resolver in
Webflow or run environment canaries until the restricted keys and matching
Xano routes are published.

- Create `opportunities_v3_test`, `Freelancers3.0-production`,
  `opportunities_v3_production`, and the five environment-specific Starter
  replicas for both TEST and production.
- Create distinct restricted TEST and production search-only keys. Permit each
  key to search only its two managed environment indexes, its five Starter
  replicas, and the four shared public indexes listed above.
- Add the public host configuration to a GitHub-owned config file. Load it
  immediately before `v3/algolia-environment.js`.
- Run the Xano configure endpoints for each environment after the matching
  restricted write keys are present.
- Publish the five staged Xano Algolia units only after masked configuration
  readback passes.
- Reindex the exact TEST and production cohorts separately. Reconcile stable-ID
  digests and stop on the first cross-environment record.
- After the GitHub source release, purge jsDelivr and verify the served source
  bytes. Then install the resolver before wf-algolia, publish staging first,
  and verify loaded bytes and runtime attributes.

Unknown hosts, missing values, an unknown managed resource, shared keys, shared
indexes, and legacy dev indexes remove all client credentials and all
non-shared index attributes. On approved hosts, the unmarked `LearnContent`
index and its UI stay unchanged while the host-owned key supplies its
search-only access.
