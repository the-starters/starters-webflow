# V3 important form workflow inventory

Scope: user-facing forms that create or change an account, profile, opportunity, application, project, review, or invoice. Search/filter controls and internal test pages are not workflow forms. Availability, booking, scheduling, and paid-call payment are excluded while Elvin owns them.

| Workflow / Webflow surface | Mutation owner | Browser-code owner | Console diagnostic status | Inline Webflow application logic |
| --- | --- | --- | --- | --- |
| Brand/Talent login, `/login` and `/starter-login` | Memberstack | GitHub: `brand-account-controller.js`, `native-form-diagnostics.js`, `auth-route.js`, `password-recovery.js` | Native-form observer in this PR | No page-specific writer found |
| Brand signup, `/sign-up`, Quiz signup, and allowlisted Collection, Learn, and Starter CMS signup | Memberstack, then Xano webhook or lead-email outbox | GitHub: `brand-account-controller.js`, `native-form-diagnostics.js`, `signup-attribution.js`, Quiz controllers; the lead-entry contract lives in [`README.md`](README.md#v3-collection-learn-and-starter-lead-entry-registration) | Native-form observer in this PR | No page-specific writer found |
| Forgot/reset password | Memberstack | GitHub: `password-recovery.js`, `native-form-diagnostics.js` | Native-form observer in this PR | No page-specific writer found |
| Brand Build Account, `/complete-profile` | Memberstack + canonical Xano webhook path | GitHub: `brand-account-controller.js` | PR #401 | No page-specific writer found |
| Build Profile Consult / Full Profile | Xano | Mixed: GitHub assets in [`build-profile/`](build-profile/README.md) plus provenance-locked inline extraction candidates | GitHub submit observer plus exact-endpoint photo, portfolio, and company-experience receipts in this PR; the observer does not alter the writer | Nine self-contained blocks, the declared submit-writer behavior-change candidate, the observer, and canonical fallback loader are ready; the remaining excluded coupled blocks stay inline |
| Starter Onboarding | Xano | GitHub: `patch-onboarding-status.js` | PR #401 | No mutation writer should remain inline |
| Brand Quiz and Quiz Results | Memberstack + Xano lead-drip bridge | GitHub: `quiz-main/quiz-main.js`, `quiz-results.js`, `native-form-diagnostics.js` | Signup, Memberstack save, and lead-drip receipts in this PR | No page-specific mutation writer found |
| Talent Application steps 1–2 | Xano | GitHub: `talent-application.js`; UI replacement in PR #400 | PR #399 | 23 KB UI block remains live until PR #400 release and Webflow replacement |
| Starter Edit Profile | Xano | GitHub: `starter-edit-profile.js`; scoped inline replacement assets in [`starter-edit-profile/`](starter-edit-profile/README.md) | PR #399 for final submit plus exact-endpoint photo, portfolio, and company-experience receipts in this PR | Native Designer form markup remains; the linked controller document owns validation, submit, and cutover responsibilities |
| Opportunity create/edit/close/reopen | Xano | GitHub: `opportunities---create.js`, `opportunities-3.0.js` | PR #399 | No authoritative writer should remain inline |
| Application submit/edit/withdraw/archive/restore | Xano | GitHub: `opportunities-3.0.js` | PR #399 | No authoritative writer should remain inline |
| Start Project / Contract Generation | Xano + PandaDoc outbox | GitHub: `v3/project-form.js` | Live in v1.59.190 | No authoritative writer should remain inline |
| Project lifecycle and review | Xano | GitHub: `opportunities-3.0.js`, `v3/reviews.js` | PR #399 | No authoritative writer should remain inline |
| Generate Invoice | Xano | GitHub: `opportunities-3.0.js` | PR #399 | No authoritative writer should remain inline |
| Account Profile / Account Security email change | Memberstack + Xano webhook | GitHub: `brand-account-controller.js`, `native-form-diagnostics.js`, dashboard readback observer | PR #401 plus native Account Profile receipt in this PR | No page-specific writer found |
| Pause Membership / Cancel Membership | Webflow form request intake only; no Memberstack subscription mutation is present in the published form path | GitHub: `native-form-diagnostics.js` plus UI helpers in `account-settings/*` and `global-embeds/step-flow/*` | Request-intake receipt in this PR; success stage is `request_accepted`, never membership changed | Native forms remain in Webflow; no inline mutation writer found |

## Release gates

- PR #406 is the aggregate review candidate. This follow-up preserves its additive review stack and keeps authenticated live captures distinct from GitHub candidate hashes.
- The live 2026-08-12 Brand Dashboard readback shows `#wf-form-Pause-Membership` and `#wf-form-Cancel-Membership` as ordinary Webflow forms (`method="get"`, no `data-ms-form`, no provider action). Their successful Webflow receipt proves request intake only. A separate server-side membership-change owner is still required before the UI may truthfully claim that a membership changed.
- Replace the Talent Application inline block only after its exact backup, hash, and sentinel inventory are saved.
- Replace Build Profile blocks only after exact live-body hash matches. Apply the submit-writer behavior change only through its declared published-body capture, and keep all remaining excluded Elvin-owned or coupled blocks untouched.
- After every release, verify the loaded jsDelivr version, the current browser response, human-like safe interaction, console/network state, and canonical Xano readback where a non-side-effecting read exists.
- Do not create another project or PandaDoc document. Project 709 is the one authorized production canary.
