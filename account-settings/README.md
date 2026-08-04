# Account Settings

Browser scripts for the logged-in member's own account and billing pages —
plan state, billing dates, pause and cancel flows. Everything here reads the
Memberstack member in the browser and renders into Designer-authored elements
through a custom attribute contract; none of it holds a secret or performs a
billing mutation, which stays behind Xano.

## Memberstack plan dates

`plan-dates.js` prints a member's plan and billing dates into the page, formatted
`Jan 10, 2000`. It exists so a pause UI can tell a member the date their
subscription actually resumes, which is **not** their signup date plus a month.

Tag any text element with the field you want. That is the only attribute
required:

```html
<span ms-form-pause-date="next-billing">—</span>
```

### Every attribute

| Attribute | Goes on | Required | Default | What it does |
| --- | --- | --- | --- | --- |
| `ms-form-pause-date` | The text element that displays the date | **Yes** | — | Names which date to print. This is what makes the element render at all; an element without it is ignored. Values in the next table |
| `ms-form-pause-input` | The radio-group wrapper, **or** each input | No | — | Marks the control the member uses to choose the pause length. `resumes-at` re-renders on every `change` |
| `ms-form-pause-reveal` | A wrapper around the whole sentence | No | — | Keeps the block hidden until the member picks an option **and** every date inside resolves. Needs the paired CSS rule below |
| `ms-form-pause-months` | The date element or any ancestor | No | `1` | Static pause length in months. Used when no marked control is checked, so the date is never blank before the member picks |
| `ms-form-pause-format` | The date element or any ancestor | No | `medium` | Date shape: `medium` (`Jan 10, 2000`), `long` (`January 10, 2000`), `numeric` (`01/10/2000`), `iso` (`2000-01-10`) |
| `ms-form-pause-empty` | The date element or any ancestor | No | `—` | Text rendered when the date cannot be resolved — logged out, free plan, failed lookup. Never `Invalid Date`, never a stale value |
| `ms-form-pause-id` | The date element or any ancestor | No | — | Pins the read to one Memberstack `planId` instead of auto-picking the member's paid connection. A `planId` that matches nothing renders the empty text rather than the wrong plan |
| `ms-form-pause-tz` | The date element or any ancestor | No | `UTC` | IANA timezone used for formatting. Change it only for a block that must show wall-clock time in a fixed business zone; see the UTC note below |

Everything except `ms-form-pause-date` and `ms-form-pause-input` is read from the
element **or any ancestor**, so one wrapper can configure a whole block. An
attribute on the element itself beats the same one on a wrapper.

### Values for `ms-form-pause-date`

| Value | Source | Notes |
| --- | --- | --- |
| `signup` | `member.createdAt` | The signup date, **not** the subscription start. A member who joined free in January and upgraded in June still reads January |
| `last-billing` | `payment.lastBillingDate` | Start of the current billing period |
| `next-billing` | `payment.nextBillingDate` | End of the current period; the paid-through date |
| `cancel-at` | `payment.cancelAtDate` | Set only when cancel-at-period-end is on. Field name unconfirmed — see the note below |
| `resumes-at` | `next-billing` + pause length | The date billing restarts after the pause. Pause length comes from `ms-form-pause-input` or `ms-form-pause-months` |

Only `signup` works on a free-plan member; every `payment.*` field is legitimately
absent there (Memberstack sends `payment: null`) and renders the empty text.

A three-month pause block, configured once on the wrapper:

```html
<div ms-form-pause-months="3">
  <p>Paused from <span ms-form-pause-date="next-billing">—</span></p>
  <p>Billing resumes <span ms-form-pause-date="resumes-at">—</span></p>
</div>
```

### Letting the member pick the pause length

Mark the radio group with `ms-form-pause-input` — on the wrapper once, or on
each input — and `resumes-at` re-renders on every change:

```html
<div ms-form-pause-input>
  <label class="w-radio"><input type="radio" name="pause" value="1 month"> 1 month</label>
  <label class="w-radio"><input type="radio" name="pause" value="2 months"> 2 months</label>
  <label class="w-radio"><input type="radio" name="pause" value="3 months"> 3 months</label>
</div>
<p>Billing resumes <span ms-form-pause-date="resumes-at">—</span></p>
```

The value is parsed for its first integer, so `2` and `2 months` both mean two.
Set whichever reads better in the Designer; neither spelling silently strands the
member on the default. Radios, checkboxes, `<select>`, and a plain number input
all work.

An **unchecked** radio expresses nothing and is skipped. Reading its value anyway
is how a three-option group ends up reporting whichever option sits first in the
DOM rather than the one the member picked.

Sources resolve nearest-first: a marked control in the closest ancestor that has
one (the wrapper counts as its own scope), then the document, then the inherited
static `ms-form-pause-months`, then one month. Walking up before reading the
document is what lets two independent pause groups coexist on one page — each
output reads the group it is nested inside. With nothing checked yet the static
attribute or the default still renders, so the page never shows a blank or broken
date before the member touches the form.

The change listener is delegated on `document`, so a group inside a Webflow
component or a tab pane that is not in the DOM at load still works, and a radio
click costs **no** Memberstack round trip — the member has not changed, only the
arithmetic.

An **unanswered** group owns its own answer. If a page has two pause blocks and
only one has been touched, the untouched block falls back to its static attribute
or the default — it does not borrow the other group's checked option. This is the
reason resolution stops at the nearest enclosing group rather than continuing to
a common ancestor.

### Hiding the whole sentence until the member chooses

Wrap the paragraph — copy and inline date together — in `ms-form-pause-reveal`,
and paste the paired CSS once anywhere on the page:

```html
<style>
  [ms-form-pause-reveal]:not(.is-ms-form-pause-shown) { display: none !important; }
</style>

<div ms-form-pause-reveal>
  <p>Your membership pauses and billing resumes
     <span ms-form-pause-date="resumes-at">—</span>.</p>
</div>
```

The wrapper reveals only when **both** hold:

1. a marked control has expressed a pause length (the member chose), and
2. every date element inside the wrapper resolved to a real date.

Condition 2 is the point of wrapping a sentence rather than just the date. A
logged-out visitor, a free-plan member, or a failed lookup renders `—`, and
"Billing resumes —" is exactly the state the wrapper exists to prevent. A wrapper
containing no date element at all rests on condition 1 alone.

Note that "has not chosen yet" and "chose one month" both compute a one-month
pause, so the reveal test reads the **source** of the answer, not its value. A
static `ms-form-pause-months` does **not** count as the member choosing — it is a
fallback so the date is never blank, not a selection.

The block hides again if the member logs out, and each wrapper is governed by the
group it is nested inside.

**Why a class plus a CSS rule and not an inline style.** The rule hides the block
from the very first paint, so nothing flashes before this deferred script runs,
and revealing does not have to guess whether the Designer set the block to
`block`, `flex`, or `grid` the way restoring an inline `display` would. If the
script never loads the block stays hidden, which is the right outcome for a
sentence whose only content is a date it cannot fill.

**Do not swap the rule for the `hidden` attribute.** A Webflow class carrying
`display: flex` beats the user-agent `[hidden]` rule and the block stays visible —
the same trap documented for the favorite hearts in [`../v3/README.md`](../v3/README.md).

Install it in Page Settings -> Custom Code -> Footer, **after** the Memberstack
script:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.89/account-settings/plan-dates.js"></script>
```

Pin the tag rather than using `@latest`, matching the other V3 embeds, and bump
the version here whenever this module ships a fix.

**This module does not pause anything.** It only reads and prints. Pausing a
subscription needs the Stripe secret key, so it cannot happen in the browser — it
belongs behind a Xano endpoint that calls Stripe `pause_collection` with
`resumes_at`. Installing this script before that endpoint exists is safe; the
dates simply render.

`resumes-at` is anchored on `next-billing` and never on `signup`. A member who
pauses on the 20th with a cycle that renews on the 1st would, under "signup plus
one month", either ride 11 unpaid days or be charged mid-pause. The paid-through
date is the end of the period they already bought, so the pause starts there.
That is also what Stripe's `pause_collection.resumes_at` means.

Dates format in UTC by default because Memberstack returns billing dates as
instants. Rendering an instant in the viewer's local zone moves the calendar day
for everyone west of UTC, so a member in Los Angeles would read a renewal one day
before the one they are billed on. Override `ms-form-pause-tz` only for a block
that must show wall-clock time in a fixed business zone.

Month arithmetic clamps the day: Jan 31 plus one month is Feb 28, Feb 29 in a
leap year, and Aug 31 plus one month is Sep 30. Plain `setMonth` overflows Jan 31
into Mar 3, so do not swap it back in. Note that a clamped month is not a fixed
number of days — Aug 20 to Sep 20 is 31 days, Feb 1 to Mar 1 is 28.

Timestamps are unit-sniffed rather than assumed. `createdAt` arrives as an ISO
string while the `payment.*` dates arrive as numbers, and Memberstack is not
consistent about seconds versus milliseconds, so `toDate()` accepts `Date`, ISO
string, Unix seconds, and Unix milliseconds, splitting at `1e10`. A seconds value
passed straight to `new Date()` renders in January 1970.

The plan connection is auto-picked as the first **active** connection that
carries a `payment` object, then any active connection. A member can hold both a
free and a paid connection (see `navbar-embeds/memberstack/free-paid-anon.js`)
and only the paid one has billing dates, so "first connection" is never safe. A
`ms-form-pause-id` that matches nothing renders the empty text rather than falling
back to the wrong plan.

Fail-quiet everywhere. A logged-out visitor, a free-only member, a `payment:
null` connection, a failed `getCurrentMember`, or Memberstack never appearing all
render the `ms-form-pause-empty` text — never a stale date and never
`Invalid Date`. A page with no `[ms-form-pause-date]` element never calls
Memberstack at all.

One field name here is **not** confirmed against Memberstack's published response
example, which lists `amount`, `currency`, `status`, `lastBillingDate`, and
`nextBillingDate`: `payment.cancelAtDate`. Where that key is absent, `cancel-at`
renders the empty text, which is the correct failure. Confirm it against a real
cancel-at-period-end member before shipping UI that depends on it.

Diagnostics (unknown field name, non-numeric pause, unknown format, a failed
member lookup, Memberstack never appearing) warn on staging, localhost, and
Cloudflare tunnel hosts, or with `window.STARTERS_DEBUG === true`. Production
stays silent.

`window.StartersPlanDates` exposes `toDate`, `formatDate`, `addMonths`,
`daysBetween`, `pickConnection`, `resolveField`, `renderElement`, and `renderAll`
for console checks on staging.

Run its focused test with:

```sh
node --test account-settings/plan-dates.test.js
```

