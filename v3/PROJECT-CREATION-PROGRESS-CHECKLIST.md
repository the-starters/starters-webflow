# 🧭 V3 Project Creation Progress Checklist

Last updated: 2026-08-18

This repository checklist tracks release-safe implementation evidence. The
workspace operator checklist tracks live Webflow and browser evidence.

## ✅ Completed implementation

- [x] Diagnose duplicate `start-project` and `generate-contract` form ownership.
- [x] Scope nested Contract fields to their nearest preview source.
- [x] Project Own Contract into both authored Review destinations.
- [x] Keep Contract values out of the Basic Information projection.
- [x] Remove the Weekly Recurring datepicker minimum at runtime.
- [x] Require Flat Fee start and estimated end dates at the active step.
- [x] Set Flat Fee date-order validity before step-flow handles the event.
- [x] Coalesce dashboard return events for 30 seconds after a successful refresh.
- [x] Retry a failed lifecycle refresh on the next browser signal.
- [x] Keep mutation-triggered project refreshes immediate.

## 🧪 Automated evidence

- [x] Native first-click Own Contract interaction reaches Review.
- [x] Own Contract affirmation gates Continue.
- [x] Standard to Own to Standard updates both Contract destinations.
- [x] Weekly datepicker accepts past, current, and future dates.
- [x] Weekly datepicker stays open through captured focus-to-click sync.
- [x] Blank Flat Fee end date keeps Continue disabled.
- [x] End date on or before the start date keeps Review unreachable.
- [x] Valid Flat Fee date order enables Continue and reaches Review.
- [x] Focus, pageshow, and visibility bursts issue one lifecycle refresh.
- [x] Browser exposure and syntax scans pass.

## 🚀 Release and live verification

- [ ] No-mistakes review, tests, documentation, lint, and CI pass with no findings.
- [ ] Merge the validated PR without squash so the release tag stays reachable.
- [ ] Create the next semantic tag and GitHub release.
- [ ] Purge `@latest` jsDelivr aliases and compare served bytes with the tag.
- [ ] Publish the approved Webflow draft attributes.
- [ ] Verify the loaded scripts and attributes on both production domains.
- [ ] Complete every no-submit human-click path through Review.
- [ ] Do not click final Confirm or create a production project.

## 🛑 Stop conditions

- Stop if a human-click check issues a project creation request.
- Stop if the active Hire form differs from the audited `generate-contract` form.
- Stop if a release check finds a browser token, private webhook, or private API URL.
- Stop if any automated or live workflow path remains unverified.
