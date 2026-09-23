# Difference from the current test-page pins

The bundle starts with the exact files currently pinned by `/starter-edit-profile-test`, then applies `patches/work-experience-month-picker.patch` to two scripts:

- `v3/starter-edit-profile/unified-companies.js`: the Work Experience Start and End fields use the existing month picker; newly selected months serialize as `YYYY-MM`, while unchanged saved dates retain their original values. Removed rows release popup listeners. The unified validator still owns range errors.
- `v3/starter-edit-profile/company-experience-crud.js`: the shared picker can be destroyed when a row is rebuilt, and wrapped labels cannot lose their inputs when the picker initializes. The existing `/starter-edit-profile` form keeps its default date-range behavior.

The other 17 scripts in `runtime/` are pinned copies, including the relative diagnostic and profile hydration dependencies. `contracts/` holds the row fixture and form contract used during checks. `webflow/` contains test-page loader snippets only; they have not been applied.

The site's shared navigation, analytics, authentication, and other global embeds are still supplied by Webflow. They are deliberately outside this page-specific bundle so their production hotfixes remain independent.
