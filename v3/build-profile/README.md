# Build Profile browser controllers

The native Webflow forms and their authored success/error elements stay in Webflow. Browser logic lives in this directory and is loaded from GitHub through jsDelivr.

## Scoped migration

The files below are exact, source-controlled copies of self-contained controller blocks that are currently inline on both `/build-profile/consult` and `/build-profile/full-profile`. [`live-body-provenance.json`](./live-body-provenance.json) records the read-only Webflow page IDs, update times, script positions, character counts, and SHA-256 values captured from each page on 2026-08-12. Both pages produced the same nine body hashes.

| Original order | GitHub asset | Live inline body SHA-256 | Responsibility |
| --- | --- | --- | --- |
| 2 | `profile-photo.js` | `213646b19cc04f2b87375afeb303cc7ebe1f598cd5ffa4ce471b7c4ca895cf5c` | Authenticated profile-photo upload |
| 3 | `portfolio-crud.js` | `7ab803c9890b802f154c6f5c3f0a6d5906624f71b9683153b2f5798617e1070d` | Portfolio create, edit, delete, media, and previews |
| 4 | `portfolio-list.js` | `ddbc94bf09e237e7fc016b73c3ab0a4f361e38ba5105840c4c568886841b3255` | Portfolio list read and render |
| 5 | `company-autocomplete.js` | `eb426e9899ccfc9976c5eb061930f122d54542fa33f4453a0602aae48f842f4c` | Company and logo autocomplete |
| 6 | `work-dates.js` | `4d8aa2dbd4c7668f37430a73c92049a7a5fa566d99915f5e45a61be5dac0c321` | Work-date validation and current-role state |
| 7 | `company-experience-crud.js` | `6dc7fa7306d9558fb493cb6a6cfd6196659e0b7005c6d49831ffcc5f3261b5d3` | Company-experience CRUD |
| 12 | `field-counters.js` | `decbf5b49d1006f8a857602a33e2d89a6270fa8b9355d6311d16188f6a4bfe83` | Authored field counters |
| 13 | `bio-editor.js` | `91671c4ed05806b2ed306f50c265954ef0c36714f59c77f721e2510370c9273f` | Bio editor and word limit |
| 14 | `grouped-selects.js` | `e80bb01f28a43ebcb5b28e8ea733bac273985ddfa3235179cdfc6a9a5168ae84` | Grouped multi-select options |

`submit-diagnostics.js` is an additional observer-only loader, not a replacement
for an inline block. It watches the existing human click on `[form-submit]` and
the authored `[build-profile-success]` / `[build-profile-error]` states. It does
not read fields, intercept the click, or change the coupled writer.

Replace each exact inline block in place with its matching deferred loader. Do not consolidate or reorder these loaders: the untouched blocks between them still supply shared globals and form state.

The sitewide `v3/native-form-diagnostics.js` loader must run before these
deferred mutation assets so their photo, portfolio, and company-experience
requests can emit receipts. The root [Current Scripts](../../README.md#current-scripts)
section owns that shared loader contract.

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/profile-photo.js"></script>
```

Use the same URL pattern for the other eight files.

Add the observer loader after the final writer on both pages:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/submit-diagnostics.js"></script>
```

## Deliberately excluded

These live blocks stay unchanged while Elvin owns availability, booking, and paid-call work:

- the shared profile/session foundation;
- draft restore and incremental dropdown state;
- the final Build Profile submit writer, which includes availability and paid-call fields. The separate diagnostic observer does not change it;
- page validation and rate formatting that is coupled to those fields;
- Consult and Full Profile call/retainer visibility controllers.

This exclusion is a release boundary, not proof that the remaining inline code is acceptable long term.

## Release verification

1. Verify every file passes `node --check` and the exposure scan.
2. Release through no-mistakes, semver, and jsDelivr purge.
3. Back up every exact Webflow Code Embed block before replacement.
4. Recapture both pages and replace only a block whose script position, character count, and SHA-256 match `live-body-provenance.json`.
5. Publish staging first, then use human-like clicks for photo, portfolio, work history, counters, bio, and grouped selects without submitting the full profile.
6. Confirm each loaded response is a non-cached current release, then publish production and repeat the safe checks.
7. Scan both published domains for Airtable, Make, and PAT exposure patterns.
