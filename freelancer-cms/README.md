# freelancer-cms

**This folder is the source of truth.** The code that lives in Webflow (page/site
custom code and embed elements) is a mirror of what's in here — not the other way
around.

Unlike the CDN-served scripts elsewhere in this repo, these files are **not**
loaded via jsDelivr. They are copied/pasted into Webflow embeds by hand, and this
folder exists as the versioned backup of that code.

## Workflow

1. Make changes **here first** (or, if a change was made directly in Webflow,
   copy it back here immediately so this folder stays authoritative).
2. Paste the updated code into the corresponding Webflow embed.
3. Commit via the normal PR flow so the history stays clean.

If this folder and Webflow ever disagree, treat **this folder** as correct and
re-sync Webflow from it.

## Exception: the `/hire/<slug>` contract form

`prefill-ms-name.js`, `pre-fill-attr-val.js`, and `datepicker-current.js` are no
longer the owners of those behaviors on the Brand Contract Generation form —
`v3/project-form.js` is. Keep these files for the other CMS pages that still load
them, but do not paste them onto `/hire/<slug>`; see
[`../v3/PROJECT-FORM-WIRING.md`](../v3/PROJECT-FORM-WIRING.md).
