# V3 important form workflow inventory

Scope: user-facing forms that create or change an account, profile, opportunity, application, project, review, or invoice. Search/filter controls and internal test pages are not workflow forms. Availability, booking, scheduling, and paid-call payment are excluded while Elvin owns them.

| Workflow / Webflow surface | Mutation owner | Browser-code owner | Copyable diagnostic status | Inline Webflow application logic |
| --- | --- | --- | --- | --- |
| Brand login, `/login` | Memberstack | GitHub: `brand-account-controller.js`, `auth-route.js`, `password-recovery.js` | Memberstack-native only; shared receipt pending | No page-specific writer found |
| Brand signup, `/sign-up` and Quiz signup | Memberstack, then Xano webhook | GitHub: `brand-account-controller.js`, `signup-attribution.js`, Quiz controllers | Memberstack-native only; shared receipt pending | No page-specific writer found |
| Forgot/reset password | Memberstack | GitHub: `password-recovery.js` | Memberstack-native only; shared receipt pending | No page-specific writer found |
| Brand Build Account, `/complete-profile` | Memberstack + canonical Xano webhook path | GitHub: `brand-account-controller.js` | PR #401 | No page-specific writer found |
| Build Profile Consult / Full Profile | Xano | Mixed: GitHub assets in [`build-profile/`](build-profile/README.md) plus untouched inline Webflow blocks | Profile writer receipt not yet complete | Nine self-contained blocks in this PR; excluded coupled blocks remain inline |
| Starter Onboarding | Xano | GitHub: `patch-onboarding-status.js` | PR #401 | No mutation writer should remain inline |
| Brand Quiz and Quiz Results | Memberstack + Xano lead-drip bridge | GitHub: `quiz-main/quiz-main.js`, `quiz-results.js` | Shared receipt pending | No page-specific mutation writer found |
| Talent Application steps 1–2 | Xano | GitHub: `talent-application.js`; UI replacement in PR #400 | PR #399 | 23 KB UI block remains live until PR #400 release and Webflow replacement |
| Starter Edit Profile | Xano | GitHub: `starter-edit-profile.js`; scoped inline replacement assets in `v3/starter-edit-profile/` | PR #399 | Six self-contained blocks are ready for exact loader replacement; the final submit and excluded field coupling remain inline |
| Opportunity create/edit/close/reopen | Xano | GitHub: `opportunities---create.js`, `opportunities-3.0.js` | PR #399 | No authoritative writer should remain inline |
| Application submit/edit/withdraw/archive/restore | Xano | GitHub: `opportunities-3.0.js` | PR #399 | No authoritative writer should remain inline |
| Start Project / Contract Generation | Xano + PandaDoc outbox | GitHub: `v3/project-form.js` | Live in v1.59.190 | No authoritative writer should remain inline |
| Project lifecycle and review | Xano | GitHub: `opportunities-3.0.js`, `v3/reviews.js` | PR #399 | No authoritative writer should remain inline |
| Generate Invoice | Xano | GitHub: `opportunities-3.0.js` | PR #399 | No authoritative writer should remain inline |
| Account Profile / Account Security email change | Memberstack + Xano webhook | GitHub: `brand-account-controller.js` | PR #401 | No page-specific writer found |
| Pause Membership / Cancel Membership | Current published form path is Webflow-native; canonical mutation owner not established by this audit | GitHub owns only UI helpers (`account-settings/*`, `global-embeds/step-flow/*`) | Missing | Mutation path requires a separate end-to-end authority audit before diagnostics |

## Release gates

- PRs #399, #400, and #401 must merge before their diagnostics or ownership changes can be released.
- Replace the Talent Application inline block only after its exact backup, hash, and sentinel inventory are saved.
- Replace Build Profile blocks only after exact live-body hash matches. Keep all excluded Elvin-owned or coupled blocks untouched.
- After every release, verify the loaded jsDelivr version, the current browser response, human-like safe interaction, console/network state, and canonical Xano readback where a non-side-effecting read exists.
- Do not create another project or PandaDoc document. Project 709 is the one authorized production canary.
