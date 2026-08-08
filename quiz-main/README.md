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

`quiz-attribution.js` captures paid-click attribution, reports the signup back to
Meta, and saves the captured values onto the new member when no other script will.
Load it site-wide with `defer`, on every page rather than only on the quiz funnel.
An ad click can land anywhere on the site, the visitor may sign up several pages
later, and the pending-save retry described below has to run on the page the
signup redirects to:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/quiz-main/quiz-attribution.js"></script>
```

The Meta Pixel base snippet is installed separately in the Webflow site-head
custom code, with pixel ID `775648331097942`. This script never installs the
pixel. It calls `fbq` only when the pixel has already defined it, so a missing or
blocked pixel leaves the page working and simply sends no event.

### Cookie contract

Every value is stored in a first-party cookie of the same name, with a 72 hour
TTL on `path=/`:

| Cookie | Source |
| --- | --- |
| `utm_source` | `?utm_source` |
| `utm_campaign` | `?utm_campaign` |
| `utm_adset` | `?utm_adset` |
| `utm_content` | `?utm_content` |
| `fbclid` | `?fbclid` |
| `fbc` | Meta's own `_fbc` cookie, copied when ours is unset |
| `fbp` | Meta's own `_fbp` cookie, copied when ours is unset |
| `event_id` | `evt_<uuid>`, generated once and then reused |

A parameter only overwrites its cookie when the URL actually carries a non-empty
value. The freshest click therefore wins, and browsing the rest of the site never
clears an earlier click. The `_fbc` and `_fbp` copy is re-checked on every page
load, since the pixel writes those cookies itself and can finish loading after
this script runs. The event id is reused for the life of the cookie so the
browser event and any server-side copy of the same registration share one id.

### Memberstack field IDs

The captured values are written onto the member as custom fields. The field ID is
the cookie name with underscores replaced by hyphens:

`utm_source` -> `utm-source`
`utm_campaign` -> `utm-campaign`
`utm_adset` -> `utm-adset`
`utm_content` -> `utm-content`
`fbclid` -> `fbclid`
`fbc` -> `fbc`
`fbp` -> `fbp`
`event_id` -> `event-id`

These eight field IDs are verified to exist in the Memberstack app config. Do not
rename them without changing the app config first, because Memberstack silently
drops a write to a field it does not know.

Which script writes them depends on the signup route. A `/quiz` signup is followed
by `/quiz-results`, so `quiz-results.js` writes the fields there as part of its
single quiz save. Every other signup route has no follow-up writer, so
`quiz-attribution.js` writes them itself. The map therefore exists in both files.
Keep the two copies in step: a field ID present in only one of them is a value
Memberstack silently drops on one of the two routes. The
`quiz-attribution.test.js` drift guard asserts both maps still match.

### Signup pages

A page arms the signup watch when **either** of these is true, in this order:

1. its path is in the script's `SIGNUP_PATH_POLICY` map, or
2. it carries at least one `form[data-ms-form="signup"]` and no
   `form[data-ms-form="login"]`.

The path map holds the two hand-audited pages and its policy is used verbatim:

| Page | After signup | Who writes the fields |
| --- | --- | --- |
| `/quiz` | `/quiz-results` | `quiz-results.js` |
| `/sign-up` | `/brand-dashboard` | `quiz-attribution.js` |

Path matching ignores case and a single trailing slash. Because the map is checked
first, those two keep behaving exactly as they do today whatever happens to their
markup, and `/quiz` in particular keeps deferring its field write to
`quiz-results.js` rather than racing it.

Rule 2 is what covers every other signup surface, starting with the signup modal on
`/all-starters`. It reuses the `data-ms-form="signup"` attribute Memberstack already
needs, so a new signup surface needs no Designer work and no edit to the script.
Detection counts forms present in the DOM and never checks whether they are visible,
because that modal's form sits in a `<dialog>` that is `display:none` until it opens.
Presence alone is safe: detection only arms a watch, and the pixel and the field save
both fire on the Memberstack auth transition, so a form nobody can reach fires
nothing. A page armed this way direct-saves the fields.

A login form on the same page is a veto, and it applies to rule 2 only. A page with
both kinds cannot tell a signup apart from a login, and reading a login as a signup
would fire a false `CompleteRegistration` and stamp that browser's UTM values onto a
member who already has their own. A missed attribution is the cheaper failure, so an
ambiguous page is not watched at all and says why in a staging-only warning. Pure
login pages such as `/login` and `/starter-login` fall out of the same rule: no
signup form, no watch.

The scan runs once at `DOMContentLoaded`. `window.StartersAttribution.rearm()` re-runs
it for a caller that injects a signup form later, the same shape as
`window.StartersMsRedirect.apply()` in `v3/starters-ms-redirect.js`. It returns whether
the watch is armed and is a no-op once it is, because a second `onAuthChange` listener
would fire `CompleteRegistration` twice.

The script binds no form or submit listeners of any kind. It reads the DOM to decide
whether to watch, and nothing more.

### CompleteRegistration

On a signup page the script reads whether the visitor arrived logged out and then
listens for the Memberstack auth change. The event fires as
`fbq('track', 'CompleteRegistration', {}, { eventID: <event_id> })` and fires for
every signup, including one with no ad parameters at all. If `fbq` is not a
function at that moment the event is skipped and nothing is marked as fired, so a
pixel that loads later in the session can still report the next transition.

An unreadable starting member state is not treated as logged out. The first
definitive auth event after that only arms the watch: a logged-in replay is
ignored (the visitor was already signed in), and a logged-out reading waits for a
later transition. Treating a failed `getCurrentMember` as logged out would fire
the pixel and start a spurious field save on the next auth replay.

A `sessionStorage.startersCompleteRegistrationFired` flag limits the event to one
fire per browser session, and every signup surface shares that one flag. This is
what covers a refresh: Memberstack replays the authenticated state on the next load,
and without the flag the replay would look like a second registration.

### Direct signup field save

A signup form's own redirect can navigate the browser away while the `updateMember`
request is still in flight. The `/sign-up` form carries
`redirect="/brand-dashboard"`; the `/all-starters` modal redirects to
`/all-starters?modal-id=signup-modal`, which reloads the same page to reopen the
modal and cuts the request off just as effectively. The save is therefore written to
survive being cut off:

1. On the transition, the non-empty attribution cookies are snapshotted into
   `sessionStorage.startersAttributionPendingFields` (field ID keys), and
   `sessionStorage.startersAttributionPendingSave` is set, both synchronously.
   Absent and empty cookies — including whitespace-only values — are omitted, so
   a later untagged visit never blanks a value an earlier tagged visit captured.
2. Then `updateMember` is called with that snapshot.
3. The marker and snapshot are cleared only once the write is confirmed.

Every page load checks that marker, and a page that finds it waits for
Memberstack, confirms a logged-in member, and re-attempts the write from the
snapshot (not from live cookies). That is what completes on the landing page a
save the redirect killed on the signup page, without letting a fresh ad click between
those two pages overwrite the values the signup captured. A marker left over from
before snapshots existed (or when storage was blocked on the signup page) falls
back to live cookies.

A marker found while Memberstack reports the visitor logged out cannot ever be
filled, so it is cleared without a write. Two states are excluded from that
cleanup: an unreadable member state is not the same thing as a logged-out one,
and the narrow race where a stale marker was already present at load, this page's
own signup re-raised it while that retry's member read was still in flight, and
the read then comes back logged out. Both leave the marker alone for the next
load.

A failed or unavailable write leaves the marker set, warns on staging, and never
throws into the page. With cookies blocked there is nothing to persist, so the
marker is cleared without a write rather than retried on every page forever.

`window.StartersAttribution.getParams()` returns the current cookie values for
debugging, `window.StartersAttribution.rearm()` reports (and, where a signup form
has appeared since load, starts) the signup watch, and
`window.StartersAttribution.release` reports the shipped version.
Console warnings are staging-only (`*.webflow.io`, localhost, `127.0.0.1`,
`*.trycloudflare.com`) or with `window.STARTERS_DEBUG === true`, so production
stays silent.

## Diagnostics

Append `?starterQuizDebug=1` (also `true` or `yes`) to enable namespaced console
logs for the session. Use `?starterQuizDebug=0` (also `false` or `no`) to clear
the session flag. A `localStorage.starterQuizDebug` value of `"true"` also
enables logging. Logging defaults off across the homepage, `/quiz`, and
`/quiz-results` controllers.

Run the focused quiz tests, including the form-selector contract regression,
with:

```sh
node --test quiz-main/*.test.js quiz-results-config.test.js quiz-taxonomy-compatibility.test.js quiz-member-json-fallback.test.js quiz-results-pending-draft.test.js
```
