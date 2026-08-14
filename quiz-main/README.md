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

The branches are tested in this order, and the first match wins:

| Member state | `/quiz` behavior | `?retake=` |
| --- | --- | --- |
| Paid Brand (`pln_new-paid-plan-463h04ph`) or Test Brand (`pln_dorxata-test-brand-plan-777r02pa`) | Replace with `/brand-dashboard` | Suppressed |
| Talent (`pln_dorxata-test-free-plan-dvcg0k8o`) | Replace with `/starter-dashboard` | Ignored |
| Any logged-in member whose `sessionStorage.starterQuizPending` payload has `status: 'ready'`, whatever their plan and custom field say | Replace with `/quiz-results` | Suppressed |
| Free Brand (`pln_free-plan-f6kn0dxz`) with a non-empty `starter-quiz` custom field | Replace with `/quiz-results` | Suppressed |
| Incomplete free Brand, logged-out visitor, inactive or unknown plan | Stay on `/quiz` | n/a |

### Ready-payload safety net

The `ready`-payload row is a self-healing branch for a signup that came back to
the wrong page: if Memberstack loses the post-signup destination (see the signup
redirect contract below), the brand-new member lands on `/quiz` at step 1, and
`starter-quiz` is no help because `/quiz-results` is what writes it. The `ready`
payload `quiz-main.js` saved immediately before signup is the only evidence the
quiz was finished, so it alone moves them. It deliberately does not require a
plan or the custom field — a member who just signed up has neither yet.

Only an explicit `ready` counts. A `draft` or status-less payload just means
somebody looked at the quiz, and a malformed payload is ignored silently; all
three leave the visitor on `/quiz`. This is stricter than `quiz-results.js`,
which also accepts a status-less payload as usable, because there the fallback
costs a member their saved answers and here it only costs a redirect. The
controller never writes or deletes the key: `quiz-loader.js` derives its
skip-on-refresh run id from the same key's `updatedAt`, and `quiz-results.js`
renders from the payload.

The branch sits after both the paid-Brand and Talent bounces so neither
destination changes, and `?retake=` suppresses it like every other Brand
redirect — a deliberate retake has to be able to sit on `/quiz` with a stale
`ready` payload still in session.

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

- restores this session's own unmarked answers first, from the
  `sessionStorage.starterQuizPending` draft below, setting every checkbox to
  *exactly* what the draft holds (see the restore-order contract);
- otherwise reads bucket IDs from `sessionStorage.quizSelectedCategories`,
  written by `quiz-home.js`;
- maps those buckets to category checkbox IDs through the hidden
  `[data-quiz-bucket]` CMS list and restores the matching category selections;
- clears `quizSelectedCategories` on the first trusted user edit, so the seed
  cannot outlive the answers it seeded;
- asynchronously reads a logged-in member's saved `starterQuiz` object from
  Memberstack member JSON and restores its matching category and subcategory
  IDs;
- switches the start-heading copy between `[data-start-default]` and
  `[data-start-filled]` when any source pre-fills the form;
- saves `sessionStorage.starterQuizPending` as answers change (`draft`, also
  written once on page load) and before signup or results navigation (`ready`);
  and
- sends a logged-in retaker directly from the final quiz step to
  `/quiz-results`, bypassing the signup step; and
- owns the post-signup redirect attributes on the signup form (next section).

### Restore-order contract

`restoreQuizSelections()` runs on boot and again on every `pageshow`, and the
order is load-bearing:

1. **The session draft wins.** If `starterQuizPending` holds any category or
   subcategory and is not marked as a Memberstack cache,
   `restoreCategoriesFromDraft()` applies it as an exact match, so an answer the
   user cleared stays cleared. A payload with a `memberstackSavedAt` marker is
   ignored here because it may belong to a member who logged out in the same
   tab; current-member answers come through the Memberstack JSON restore path.
2. **The homepage seed is the fallback.** `quizSelectedCategories` applies only
   when there is no draft yet, i.e. a genuine first arrival. An empty draft
   payload counts as "no draft", which is what keeps homepage prefill working
   on a first visit.
3. **The seed is single-use.** The first trusted edit inside the quiz clears the
   key, so clearing every answer cannot fall back to replaying it.

⚠️ **Do not restore the homepage seed by union again.** Before v1.59.88,
`restoreCategoriesFromStorage()` was the only restore path and it *only checked*
boxes, never unchecked. Combined with a `quizSelectedCategories` key that nothing
ever updated or cleared, a reload or a browser Back/Forward re-checked a category
the user had removed (INITIATIVE-136: "Prepopulated Retail & Marketplace when it
wasn't previously selected"), and a reload replaced their real answers with the
stale homepage picks. The phantom selection also reached `/quiz-results`, because
it was written straight back into the `starterQuizPending` payload.

Regression coverage: `quiz-main-draft-restore.test.js`.

### Signup redirect contract

At boot the controller sets `redirect="/quiz-results"` on
`[data-quiz-form="signup"]`, from the same `resultsRedirectPath` constant the
logged-in retake redirect uses.

Both attributes have to be there, and they are read by different Memberstack code
paths. Memberstack picks up `data-ms-redirect` only from a click listener, which
stashes the value in `sessionStorage["ms-redirect-override"]` when a click lands
inside the element, so an Enter-key submit never registers the override. Its
signup submit handler instead reads the plain `redirect` attribute off the form,
and that value outranks both the stored override and the server-side plan
redirect. With `data-ms-redirect` alone, an Enter-key signup therefore fell back
to the plan redirect and returned the brand-new member to `/quiz` at step 1. This
is the same defect that `configureLoginForms()` in `v3/auth-route.js` fixes for
the login and signup forms on `/login`, and the fix is the same shape.

`data-ms-redirect` stays the Designer's: it is what carries the destination
through the click-driven provider flows, so the controller only fills it in when
the markup has no value at all and never overwrites an authored one. Adding
`redirect="/quiz-results"` in the Designer as well is harmless — the script
writes the same value, so the two are idempotent.

The pending payload contains `categories`, `subcategories`, an optional
`resultSlug`, `status`, `updatedAt`, and `completedAt`. `quiz-results.js` owns
consuming it, and treats a `draft` payload as no data at all: browsing `/quiz`
alone leaves a draft behind, so honouring it used to hold a logged-out visitor
on an empty `/quiz-results` instead of sending them back to the quiz. Only
`ready` renders. A payload with no `status` field still counts as usable, since
that shape only comes from older Memberstack records. `/quiz-results` ignores the
draft without deleting it, because `quiz-loader.js` derives its skip-on-refresh
run id from the same key's `updatedAt` — the sole exception being a draft that
also carries the `memberstackSavedAt` marker described below, which a logged-out
visitor does not own.

`quiz-results.js` also re-uses the key to cache a logged-in member's saved
answers, adding a `memberstackSavedAt` marker that `savePendingQuiz()` here never
writes. Since `sessionStorage` survives logout, `/quiz-results` deletes a marked
payload as soon as Memberstack positively reports the visitor as logged out
(never when Memberstack is merely unavailable), so a signed-out browser stops
previewing the previous member's results; an unmarked pre-signup payload is left
alone and still previews. On `/quiz`, `quiz-main.js` likewise refuses to restore
a marked payload as a visitor draft, leaving current-member answers to the
Memberstack JSON restore path.

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

## Ad attribution

Paid-click attribution moved out of this folder. The script is now
`v3/signup-attribution.js` and its documentation — the cookie contract, the ten
verified Memberstack field IDs, the signup-page arming rule, the login veto,
`rearm()`, the Meta Pixel prerequisite, and the direct-save retry — lives in
[`v3/README.md`](../v3/README.md#signup-attribution). There is deliberately no
second copy of the field IDs here: the drift guard exists to stop exactly that.

It matters to the quiz because it is the other half of the field write. A `/quiz`
signup defers its attribution save to `quiz-results.js`, which reads the cookies
that script wrote and sends them in the same `updateMember` call as
`starter-quiz`. Two writers for one signup would be a race, so `/quiz` is mapped
to `directSave: false` there and the coupling has to stay intentional in both
files.

## Diagnostics

Append `?starterQuizDebug=1` (also `true` or `yes`) to enable namespaced console
logs for the session. Use `?starterQuizDebug=0` (also `false` or `no`) to clear
the session flag. A `localStorage.starterQuizDebug` value of `"true"` also
enables logging. Logging defaults off across the homepage, `/quiz`, and
`/quiz-results` controllers.

Run the focused quiz tests, including the form-selector contract regression,
with:

```sh
node --test quiz-main/*.test.js v3/algolia-environment.test.js quiz-taxonomy-compatibility.test.js quiz-member-json-fallback.test.js quiz-results-pending-draft.test.js
```
