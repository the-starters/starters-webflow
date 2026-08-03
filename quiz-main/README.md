# Starter quiz page controllers

Load the homepage category controller once on the home page with `defer`:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/quiz-main/quiz-home.js"></script>
```

It owns `[data-quiz-form="home"]`, saves the IDs of its selected checkboxes to
`sessionStorage.quizSelectedCategories` whenever they change or the form is
submitted, then redirects submissions to `/quiz`. The controller can initialize
before or after the DOM has been parsed and ignores duplicate script loads.

Load both controllers on `/quiz` with `defer`, after the site Memberstack
bootstrap:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/quiz-main/quiz-redirect.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/quiz-main/quiz-main.js"></script>
```

## Entry redirect

`quiz-redirect.js` waits up to ten seconds for `$memberstackDom` and handles
members with an active plan. `/quiz` sits outside all three page tables in
`v3/route-guard.js`, so this controller is the only thing deciding who may not
sit on it.

| Member state | `/quiz` behavior | `?retake=` |
| --- | --- | --- |
| Paid Brand (`pln_new-paid-plan-463h04ph`) or Test Brand (`pln_dorxata-test-brand-plan-777r02pa`) | Replace with `/brand-dashboard` | Suppressed |
| Talent (`pln_dorxata-test-free-plan-dvcg0k8o`) | Replace with `/starter-dashboard` | Ignored |
| Free Brand (`pln_free-plan-f6kn0dxz`) with a non-empty `starter-quiz` custom field | Replace with `/quiz-results` | Suppressed |
| Incomplete free Brand, logged-out visitor, inactive or unknown plan | Stay on `/quiz` | n/a |

Add `?retake=true`, `?retake=1`, or `?retake=yes` to keep an otherwise redirected
Brand on the quiz. Retake links must use one of these values. The Talent bounce
deliberately ignores the parameter (decision by Jerico 2026-08-03): the hatch
exists so a Brand can re-run their own quiz, and Talent has no quiz to retake.
A member holding both Talent and paid Brand plans keeps the paid
`/brand-dashboard` outcome and its retake hatch — that state is the
`conflicting-plan-roles` configuration error, and this page is not where it gets
resolved. The controller also re-evaluates after Memberstack auth changes. Its
plan IDs match the roles in `v3/route-guard.js`, including the Test Brand plan
used for staging verification.

## Main controller

`quiz-main.js` owns the category/subcategory flow and supports both the custom
step layout and the tab-driven layout. It:

- reads bucket IDs from `sessionStorage.quizSelectedCategories`, written by
  `quiz-home.js`;
- maps those buckets to category checkbox IDs through the hidden
  `[data-quiz-bucket]` CMS list and restores the matching category selections;
- asynchronously reads a logged-in member's saved `starterQuiz` object from
  Memberstack member JSON and restores its matching category and subcategory
  IDs;
- switches the start-heading copy between `[data-start-default]` and
  `[data-start-filled]` when either source pre-fills the form;
- saves `sessionStorage.starterQuizPending` as answers change (`draft`, also
  written once on page load) and before signup or results navigation (`ready`);
  and
- sends a logged-in retaker directly from the final quiz step to
  `/quiz-results`, bypassing the signup step.

The pending payload contains `categories`, `subcategories`, an optional
`resultSlug`, `status`, `updatedAt`, and `completedAt`. `quiz-results.js` owns
consuming it, and treats a `draft` payload as no data at all: browsing `/quiz`
alone leaves a draft behind, so honouring it used to hold a logged-out visitor
on an empty `/quiz-results` instead of sending them back to the quiz. Only
`ready` renders. A payload with no `status` field still counts as usable, since
that shape only comes from older Memberstack records. `/quiz-results` ignores the
draft without deleting it, because `quiz-loader.js` derives its skip-on-refresh
run id from the same key's `updatedAt`.

Saved Memberstack answers are restored whenever a logged-in member with a
non-empty `starterQuiz` object reaches `/quiz`; `?retake=true` controls only the
entry redirect. The restore checks matching boxes without clearing existing
selections, so its `categoryIds` and `subcategoryIds` are combined with any
homepage-bucket categories. Restoring a saved subcategory also selects its
parent category so merged or renamed subcategories keep a valid parent. If the
member edits or advances the quiz before Memberstack returns, the delayed
restore is skipped.

Saved answers created before a taxonomy rollout are normalized before retake
prefill and results matching. Deterministic renames and merges map to their
current IDs. Retired choices without an approved successor are discarded; if a
saved payload has no current category left, `/quiz-results` clears the stale
session payload and sends the member to `/quiz?retake=true&taxonomyUpdate=1`.
Keep the compatibility aliases, the 12-category/43-subcategory results catalog,
and `quiz-taxonomy-compatibility.test.js` aligned with each approved taxonomy
release.

### Webflow markup contract

Publish these custom attributes in Webflow before releasing scripts that use
this contract. Keep the existing Webflow form names and IDs during the rollout;
the scripts no longer use them, but removing them is a separate cleanup.

Required elements:

- stable form roles that are independent of Webflow-generated form names and IDs:
  `[data-quiz-form="home"]` on the single homepage quiz form,
  `[data-quiz-form="categories"]` on the single main category form,
  `[data-quiz-form="subcategories"]` on every subcategory form, and
  `[data-quiz-form="signup"]` on the single final signup form;
- category and subcategory steps marked with `[data-main-is-categories]` and
  `[data-main-is-subcategories]`;
- navigation under `[data-tab-wrapper]` using `[data-tab="previous|next"]`, or
  wrappers marked `[data-step-back]` and `[data-step-next]`.

Optional integrations:

- `[data-quiz-bucket]` contains one child per homepage bucket. Each child has a
  checkbox whose `id` is the saved bucket ID and a direct nested Webflow CMS
  list whose `[role="listitem"]` text values are category checkbox IDs.
- `[data-start-heading]` contains the alternative
  `[data-start-default]` and `[data-start-filled]` copy.
- Tab-driven subcategory panels use `[data-tab-category-link="<category id>"]`
  and active slides use `[data-tab-content]`; the final answer slide must be
  `data-tab-content="ways"` and the signup slide
  `data-tab-content="signup"`.
- Non-tab subcategory items use `[data-category="<category id>"]`.
- `[data-quiz-form="signup"]` and `[data-ms-auth-provider]` triggers cause the ready payload
  to be saved before authentication.
- `[data-quiz-result-slug="<slug>"]` supplies an already-calculated result slug.

The script updates both native checkbox state and Webflow's custom checked
class. Category IDs in the forms, bucket mappings, and subcategory parent
attributes must match after trimming. Saved subcategory IDs match the checkbox
`id`, then its `value`, then its visible label.

## Diagnostics

Append `?starterQuizDebug=1` (also `true` or `yes`) to enable namespaced console
logs for the session. Use `?starterQuizDebug=0` (also `false` or `no`) to clear
the session flag. A `localStorage.starterQuizDebug` value of `"true"` also
enables logging. Logging defaults off across the homepage, `/quiz`, and
`/quiz-results` controllers.

Run the focused quiz tests, including the form-selector contract regression,
with:

```sh
node --test quiz-main/*.test.js quiz-results-config.test.js quiz-taxonomy-compatibility.test.js quiz-member-json-fallback.test.js
```
