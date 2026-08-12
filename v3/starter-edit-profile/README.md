# Starter Edit Profile browser controllers

The native `/starter-edit-profile` form, fields, and success/error elements stay authored in Webflow. This directory owns the page-specific portfolio and company controllers. It reuses the reviewed profile-photo and work-date assets from `v3/build-profile/`.

## In-place loader replacements

Replace only an exact live inline body whose index and SHA-256 match the captured `page.scripts` records in `live-body-provenance.json`. The separate `candidateAssets` records identify the instrumented GitHub files. Keep each replacement in its existing Code Embed position.

| Live index | GitHub asset | Responsibility |
| --- | --- | --- |
| 84 | `v3/build-profile/profile-photo.js` | Authenticated profile-photo upload |
| 87 | `v3/starter-edit-profile/portfolio-crud.js` | Edit-profile portfolio create, edit, delete, media, and previews |
| 88 | `v3/starter-edit-profile/portfolio-list.js` | Edit-profile portfolio list read and render |
| 89 | `v3/starter-edit-profile/company-autocomplete.js` | Edit-profile company and logo autocomplete |
| 90 | `v3/starter-edit-profile/company-experience-crud.js` | Edit-profile company-experience CRUD |
| 91 | `v3/build-profile/work-dates.js` | Work-date validation and current-role state |

Loader pattern:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starter-edit-profile/portfolio-crud.js"></script>
```

Use the matching asset path for the other five replacements. Do not combine or reorder the loaders.

The sitewide `v3/native-form-diagnostics.js` loader must run before these
deferred mutation assets so their photo, portfolio, and company-experience
requests can emit receipts. The root [Current Scripts](../../README.md#current-scripts)
section owns that shared loader contract.

## Deliberately excluded

The following live blocks remain unchanged because they own or are coupled to Elvin's availability, booking, and paid/free-call work:

- the shared profile/session foundation;
- incremental form state and validation that reads availability;
- country/state/city state tied to the shared profile object;
- the final 17.8 KB submit controller, including availability and paid/free-call fields;
- rate and call visibility behavior.

Account-settings tabs, membership panels, and pause/cancel UI are separate shared-component work and are not part of this extraction.

## Release verification

1. Run the ownership test, syntax checks, and browser-secret scan.
2. Release through no-mistakes, semver, and jsDelivr purge.
3. Save exact backups of all six live Code Embed bodies.
4. Verify each live body still matches the provenance contract before replacement.
5. Replace one exact block with one deferred loader in the same position.
6. Publish staging and use human-like clicks for photo, portfolio, company experience, and work dates without submitting the full profile.
7. Verify current network responses, console state, and no unexpected Xano writes, then publish production and repeat.
8. Scan both published domains for Airtable, Make, and PAT exposure patterns.
