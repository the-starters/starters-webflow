# Webflow wiring guides

This folder is the shared home for the repository's `*-WIRING.md` guides.
Wiring describes how a browser script connects to Designer-authored elements,
Memberstack, Xano, and shared libraries: the required attributes, script load
order, data ownership, visible states, installation steps, and QA checks.

## Context and ownership

Read the relevant guide before changing a feature's Webflow attributes,
integration contract, or installation. Each guide owns its feature's wiring
details; this index helps you find it. The scripts remain in their existing
source folders, including [`v3/`](../../v3/README.md) and
[`global-embeds/`](../../global-embeds/README.md).

Designer owns the native markup and presentation. Browser scripts connect to
that markup through the documented attributes. Each guide identifies which
system owns its identity, data, and mutations; consult that ownership before
adding another writer or controller.

A guide's presence here does not establish that its feature is installed or
live. Preserve and check its status, release pins, prerequisites, known gaps,
and QA notes. The [repository release rules](../../README.md#sync-safety)
explain how source changes reach Webflow. The Brand project-proposals guide
below is explicitly superseded and retained as history.

## Find a guide

### Authentication, access, and membership

- [Auth route](AUTH-ROUTE-WIRING.md) — login routing and auth-page loader.
- [Route guard](ROUTE-GUARD-WIRING.md) — sitewide access and role routing.
- [Membership checkout authority](MEMBERSHIP-CHECKOUT-AUTHORITY-WIRING.md) — checkout handoff and membership authority.
- [Brand account and Starter email](BRAND-ACCOUNT-WIRING.md) — identity, signup, account forms, and email ownership.

### Profile completion and onboarding

- [Brand profile redirect](BRAND-PROFILE-REDIRECT-WIRING.md) — incomplete paid Brands entering protected pages.
- [Complete-profile redirect](COMPLETE-PROFILE-REDIRECT-WIRING.md) — role routing and completed Brand exit.
- [Complete-profile back button](COMPLETE-PROFILE-BACK-WIRING.md) — referrer-based escape link.
- [Complete-profile loader](COMPLETE-PROFILE-LOADER-WIRING.md) — submit spinner and form dimming.
- [Build-profile redirect](BUILD-PROFILE-REDIRECT-WIRING.md) — Talent funnel position on profile-building pages.
- [Starter profile redirect](STARTER-PROFILE-REDIRECT-WIRING.md) — unfinished Starter entry routing.
- [Onboarding done redirect](ONBOARDING-DONE-REDIRECT-WIRING.md) — read half of onboarding completion.
- [Onboarding patch status](ONBOARDING-PATCH-STATUS-WIRING.md) — write half and post-submit redirect.
- [Onboarding profile preview](ONBOARDING-PROFILE-PREVIEW-WIRING.md) — the member's profile preview card.
- [Onboarding tour](ONBOARDING-TOUR-WIRING.md) — attribute-authored product tours.

### Public profiles, hiring, and projects

- [Hire profile](HIRE-PROFILE-WIRING.md) — public profile data, ownership, and service routing.
- [Agency profile](AGENCY-PROFILE-WIRING.md) — the public profile's Agency section.
- [Profile portfolio](PROFILE-PORTFOLIO-WIRING.md) — Highlights and case studies.
- [Direct-hire project form](PROJECT-FORM-WIRING.md) — Brand Contract Generation form.
- [Starter project form](STARTER-PROJECT-FORM-WIRING.md) — Starter Dashboard Contract Generation form.
- [Brand project proposals (superseded)](BRAND-PROJECT-PROPOSALS-WIRING.md) — historical approval workflow and its replacement.

### Call settings

- [Free Call settings](FREE-CALL-SETTINGS-WIRING.md) — native settings form and canonical service state.
- [Paid Call settings](PAID-CALL-SETTINGS-WIRING.md) — native settings form, readiness, and release gate.

### Search and shared rendering

- [AI Recruiter](AI-RECRUITER-WIRING.md) — native search UI, authenticated boundary, and operations.
- [Algolia environment](ALGOLIA-ENVIRONMENT-WIRING.md) — host-selected search configuration.
- [Opportunity detail role feeds](OPPORTUNITY-DETAIL-ROLE-FEEDS-WIRING.md) — role-scoped wf-xano activation on the shared detail page.
- [Replica list](REPLICA-LIST-WIRING.md) — curated static lists and their relayout companion.
- [Xano grabber](XANO-GRABBER-WIRING.md) — mirroring values already rendered in the DOM.

## Maintaining this folder

1. Put new wiring guides here as `FEATURE-WIRING.md` and add them to this index.
2. Keep feature-specific contracts in their guide; link to shared rules and
   related guides instead of duplicating them. General module READMEs, access
   matrices, specs, and progress checklists stay with their owning modules.
3. Update the guide alongside changes to attributes, endpoints, ownership,
   installation, or failure states. Record live verification separately from
   local implementation and tests.
4. Use sibling links for other wiring guides and `../../` paths for repository
   source files. Inline paths and shell commands are relative to the repository
   root unless the guide states otherwise.
5. When moving or renaming a guide, update incoming links, source comments, and
   its relative links. Keep script paths and CDN URLs tied to the source files.

Related references: [V3 access matrix](../../v3/ACCESS-MATRIX.md),
[form workflow inventory](../../v3/FORM-WORKFLOW-INVENTORY.md), and
[repository glossary](../../CONTEXT.md).
