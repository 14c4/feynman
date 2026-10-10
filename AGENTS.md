# feynman.ai — Development guide and milestone tracker

## Project overview

feynman.ai is now a Health-track test-readiness app for material the learner has already studied. It combines short retrieval assessments, supportive verbal explanation, matched rechecks, and optional self-reported nervousness. It does not diagnose anxiety, infer anxiety from vital signs, or promise anxiety reduction.

Approved workflow: describe material (optional pasted notes) → three baseline questions → actual grading → focused curious-student conversation → three different matched recheck questions → concise reflection → another cycle or finish. One resumable session owns all stages and cycles.

## Approved revamp — active instructions

### Hackathon simplification — current priority

The user narrowed implementation to ONE complete practice cycle and requested a checkpoint after typecheck. This overrides the broader R-series implementation scope below. Current priority: description → three Gemini baseline questions → actual grading → weak-concept ElevenLabs conversation → three paired follow-up questions → grading → comparison. Use in-memory single-process backend sessions, simple validated JSON and clear errors. Preserve private provider keys, bounded inputs, and untrusted-material separation. Durable server persistence, request locks, multi-user infrastructure, repeat cycles, uploads, timing, and Presage are deferred. Browser drafts are a convenience, not a guarantee after server restart. Stop at the current checkpoint and report changed files, verified behavior, demo gaps and the next smallest step before another major task.

Checkpoint reached: single-cycle contracts, browser state/API wiring, assessment/conversation/results screens and in-memory backend are implemented. Application adapters call real providers; no simulated fallback is installed. Latest approved diagnostic fix: Gemini preparation now requires the complete JSON assessment shape; provider errors retain sanitized HTTP status/details; duplicate preparation messages are removed. `npm run typecheck` passed; `npm test` passed all 8 tests, including one-cycle API integration with injected TEST providers. `.env` now configures Gemini with `gemini-3.8-flash`. Real adapter calls successfully generated three concept pairs (six questions, about 8 seconds) and graded one complete sample answer (2/2 with validated evidence, about 42 seconds). These are bounded provider checks, not a verified full browser session. Intermittent Google HTTP 503 UNAVAILABLE/high-demand responses were observed and are now displayed clearly. ElevenLabs remains unconfigured; live voice, browser UI, and final history retrieval remain unverified. Lint/build have not been run at this narrowed checkpoint. Next smallest step: run a fresh browser session through baseline generation/grading, then configure and verify the private voice agent. Full R-series boxes below remain unchecked where their original acceptance extends beyond this checkpoint.

The user approved implementation of the complete R-series plan. This supersedes the topic-centric target and M-series pending-approval boundaries below; the M-series is historical context, not the active task list. Preserve the existing shell, routes, avatar, green/neutral tokens, and one React domain store.

- Public contracts are `PracticeSession`, `AssessmentAttempt`, `PracticeCycle`, and question/grade types in `shared/types.ts`. Legacy topic types remain only where old fixtures/components still require them during migration.
- Backend-only blueprints contain expected answers, rubrics, and reserved questions. Browser responses and the voice agent never receive reserved recheck questions/answers.
- Stages: preparing, baseline, baseline_evaluating, teaching, recheck, recheck_evaluating, results. Lifecycle active/paused/completed is separate. Evaluation failures preserve answers and support retry.
- Same-browser anonymous resume uses browser access references/local drafts plus a disk-backed single-instance server store. Never silently abandon on navigation. Do not persist live credentials.
- Three questions each, typed answers and optional working, skip/uncertainty, no mid-test answers or correction. Same component for baseline/recheck. Actual 0–2 rubric grades; deterministic server totals; comparisons describe these questions, not mastery.
- Practice again retains scope/rubrics and creates another conversation/recheck cycle without overwriting prior work; later rechecks use fresh questions.
- Preferred voice architecture remains private ElevenLabs Agent configured with Gemini, pending real verification. Only actual status/mode events. Final transcript retrieval is separate from disconnect; typed responses determine assessment scores.
- Optional nervousness is 1–5 self-report, never a diagnosis. File uploads, timing, and Presage implementation are deferred. Presage feasibility must not block the loop.
- A owns screens/CSS/browser voice; B owns educational generation/grading/instructions; C coordinates shared contracts, state, backend, persistence, dependencies, and tests.

### Active R-series tracker

- [ ] R1 — Pivot contracts and guide (C; A/B review). In progress. Acceptance: agreed stages, public/private boundary, grades and persistence; all consumers compile.
- [ ] R2 — Provider proof/adapters (A ElevenLabs, B Gemini, C endpoints). Depends on R1. Acceptance: real connection, contextual voice, paired generation/grading and history retrieval; absent credentials recorded as blockers.
- [ ] R3 — Resumable session foundation (C). Depends on R1. Acceptance: durable stages/drafts, pause/resume and preserved cycles.
- [ ] R4 — Home and shared assessment UI (A/C). Depends on R1/R3. Acceptance: custom description, optional notes, real questions, skip/working and same assessment UI.
- [ ] R5 — Blueprint and grading (B/C). Depends on R1/R2 Gemini proof. Acceptance: three validated pairs, fixed criteria, private keys, honest grades/errors.
- [ ] R6 — Focused conversation (A/B/C). Depends on R2–R5. Acceptance: real gap context, interruptions, supportive guidance, reserved-question exclusion.
- [ ] R7 — Reflection and repeat cycle (A/C, B review). Depends on R5/R6. Acceptance: actual comparison, optional self-report, new cycle, finish/save.
- [ ] R8 — Verification/demo (all, C coordinates). Depends on full loop. Acceptance: meaningful tests, typecheck/lint/build, available UI checks and real audio verification; blockers recorded honestly.

Current implementation session is authorized to complete R1–R8 code and checks. Do not claim live provider verification without credentials and actual successful calls. Update this tracker and README after checks. No automatic commit/push/deploy.

Stack: React, Vite, TypeScript, React Router, plain feature-scoped CSS, and a small Node HTTP backend. Planned integrations: ElevenLabs for live conversation and Gemini for lesson interpretation, student reasoning through the selected conversation architecture, and evaluation.

## Current architecture (implemented)

```text
shared/types.ts                 Domain types shared by browser and backend
src/app/App.tsx                 Router and provider composition
src/components/                AppLayout, Button, EmptyState
src/features/topics/           HomePage, TopicCard, curated topic data, CSS
src/features/study/            Preparation, student, microphone, text fallback,
                               transcript, finish controls, draft protection
src/features/feedback/         Results, concept feedback, attempts, sample fixture
src/state/                     One Context provider/reducer and useSessions
src/services/contracts/        Voice, student reasoning, evaluation interfaces
src/styles/                    Shared design tokens and global CSS
server/index.ts                HTTP startup and environment handling
server/routes.ts               Health and integration-placeholder responses
tests/                         Node lifecycle and backend-response tests
README.md                      Local setup and ownership reference
```

Routes: `/`, `/study/:sessionId`, `/results/:sessionId`. Preparation is a state within Study, not another route. Sessions/transcripts live in React memory and reset on refresh. Navigating away abandons unfinished sessions. Retry creates another session; current attempt numbering is grouped by curated topic.

Current data flow: curated topic → provider creates session → preparation → saved text transcript → completed session → Results → retry. Provider endpoints do not make API calls. The standalone Recursion sample evaluation never evaluates user input.

Reuse the current application shell, route structure, avatar, large microphone placement, collapsed text fallback, shared UI, green/neutral palette, typography, borders, and spacing. Do not rebuild the application or add a second state store.

## Agreed target architecture (not yet implemented)

- A lesson owns its title, objective, optional context/notes and optional future workspace ID.
- Sessions/attempts belong to a lesson, not a hardcoded topic ID. Suggested topics are lesson templates.
- A lesson assessment has stable concept IDs, an objective snapshot, and a version. Retry preserves it; changing the objective after teaching creates a new lesson.
- Connection state, student activity, microphone mute, and transcript readiness are separate states.
- Only finalized, ordered transcript messages are used for evaluation. Corrections replace the matching turn rather than adding duplicates.
- Evaluation includes summary, covered/gap concepts, learner transcript evidence, and one priority retry recommendation. No invented mastery percentages.
- Results distinguish actual feedback, unavailable/loading/error states, and collapsed development examples.

Shared contracts live in `shared/types.ts` and `src/services/contracts/`. M1 must coordinate the lesson/assessment additions and transcript/conversation changes; M2 migrates existing consumers together. The current `StudyTopic` and `StudySession.topicId` are still the implemented contracts, not the final lesson-based model.

Preferred conversation architecture, pending M5 verification: browser ↔ private ElevenLabs Agent configured with a Gemini model; backend issues conversation credentials and retrieves/reconciles final transcripts; backend Gemini calls interpret lessons and evaluate understanding. Use provider transcription if reliable. Do not run a second per-turn student-response engine alongside Agents.

Compare a custom Gemini transcription/reasoning + ElevenLabs TTS pipeline in M5 only if necessary. It adds turn detection, cancellation, audio queuing, interruption handling, and transcript synchronization work. Do not assume a provider disconnect guarantees a complete transcript or that listening/speaking callbacks expose a genuine thinking state.

Planned backend boundaries: health; lesson preparation; private voice-session credentials; finished conversation transcript retrieval; evaluation. Add each endpoint/module only in its approved milestone. No empty integration folders.

## Team responsibilities

| Owner | Primary files/responsibility |
| --- | --- |
| A — Frontend/ElevenLabs | `src/components/`, styles, screen components, voice contract, future ElevenLabs adapter/conversation hook |
| B — Gemini/education | `topics.ts`, sample/evaluation fixtures, lesson/evaluation contracts, future `server/learning/` prompts, assessments, validation |
| C — Backend/integration | `src/state/`, routing, `server/`, shared contracts coordination, endpoint/security handling, tooling, tests, deployment |

Coordinate `shared/types.ts`, service contracts, API shapes, dependencies/lockfile, routing, and roadmap changes. A/B supply provider logic; C reviews credentials and endpoint handling. Keep fixture changes separate from presentation work where possible.

## Development conventions

- Read this guide before starting a task. Name its ID, dependencies, acceptance criteria, and changed files.
- Implement only the approved task. Stop before the next task or major milestone unless explicitly authorized.
- Explain contract changes and their effect on teammates before editing them.
- Use PascalCase for React components, camelCase for functions/values, explicit TypeScript interfaces and discriminated state unions. Avoid `any` and unvalidated provider payloads.
- Keep feature components local; promote only genuinely shared UI. Use existing CSS tokens and scoped selectors. No component/state/backend framework is needed.
- Keep one domain state store; transient text, disclosure, and connection handles can remain local. Do not duplicate transcripts or attempts.
- Use actual provider events for activity. No fake recording, simulated speech, or fabricated assessment of custom input.
- Keep private keys server-side; never prefix them with `VITE_`. Do not commit `.env` or log credentials.
- Prefer small feature branches such as `feat/m2-homepage-copy`. PRs identify task, contract impact, checks, blockers and remaining scope. Never automatically commit, push, merge or deploy.
- Do not overwrite teammate changes or make unrelated formatting/refactoring/dependency changes.
- Check off tasks only after appropriate verification. Record failures honestly. Update only the affected tracker/current-state sections.

Commands (existing):

```sh
npm run dev
npm run dev:server
npm run typecheck
npm run lint
npm test
npm run build
```

Build includes frontend/backend/config/test typechecking. Node tests cover lifecycle and backend placeholders. UI tasks should also check the relevant route, keyboard behavior and responsive layout. Do not install a new test framework for a small presentation change.

## Historical M-series roadmap (superseded by approved R-series)

Statuses: **Not started**, **In progress**, **Blocked**, **Complete**. Estimates are person-hours; individual tasks generally target 15–60 minutes. Prior implementation is a foundation, not completion of future integration milestones.

### M0 — Existing codebase audit
Goal: understand the existing app and propose minimal changes. Owner: C with A/B review. Effort: ~1 hour. Dependencies: none. Status: **Complete**.
Files: existing screens, state, contracts, server, tests, README; audit recorded here and in the approved planning discussion.
- [x] Inspect application, reusable UI, routes, styles and session lifecycle.
- [x] Inspect service boundaries and backend placeholders.
- [x] Identify hardcoded-topic coupling, absent lessons/assessments and expanded sample feedback.
- [x] Define preservation commitments and staged architecture.
Acceptance: an affected-file plan and practical roadmap exist. No new live API verification is implied by this audit.

### M1 — Project instructions and shared contracts
Goal: establish coordinated interfaces and the living guide. Owner: C; A/B review. Effort: 2–3 hours. Dependencies: M0 and Build authorization. Status: **In progress**.
Files: `AGENTS.md`, `shared/types.ts`, service contracts, README and relevant tests.
- [x] M1.1 Create/read guide; record audited baseline, ownership and complete roadmap (30–45 min).
- [ ] M1.2 Agree lesson/assessment types and the M2 compatibility migration (30–45 min).
- [ ] M1.3 Separate connection/activity/mute/transcript-finalization contracts (30–45 min).
- [ ] M1.4 Define evaluation evidence and priority recommendation contracts (15–30 min).
- [ ] M1.5 Verify current application and shared contracts with build/lint/tests (15–30 min).
Acceptance: interfaces/ownership are understood and the existing app builds. Contract work remains a prerequisite for functional custom lesson creation.

### M2 — Homepage and lesson creation
Goal: start a user-defined lesson locally without an API. Owners: A (UI), C (state). Effort: 2–3 hours. Dependencies: M1 for lesson contracts/state work. Status: **Blocked** — the independent M2.1 presentation slice is complete; functional lesson creation awaits the M1 contracts and M2.4 migration.
Files: `HomePage.tsx`, `topics.css`, future `LessonForm.tsx`, suggestion UI/data, state, shared types, lesson tests.
- [x] M2.1 Reduce homepage introduction; use “What would you like to teach?” and remove marketing/process copy (15–30 min). **Complete.** This independent presentation slice needs only M0 and the existing routes/design; it may precede shared-contract work. Changed `HomePage.tsx` and `topics.css`; verified compact desktop/mobile layout, keyboard navigation and the existing topic-to-preparation flow.
- [ ] M2.2 Add a labeled topic form and optional context with empty/length validation (30–45 min). Requires agreed lesson contracts and M2.4 for a functional submission; do not add a deceptive custom-topic action.
- [ ] M2.3 Convert dominant topic cards into secondary form-filling shortcuts (15–30 min). Requires M2.2.
- [ ] M2.4 Store lessons; migrate curated/custom session creation and retry to `lessonId` atomically (45–60 min). Requires M1.2–M1.4; coordinate shared changes first.
- [ ] M2.5 Add previous lessons from this visit and verify custom/curated navigation (30–45 min). Requires lesson creation/state.
Acceptance: a valid arbitrary topic reaches preparation without API/workspace requirements; identity is preserved. M2.1 alone does not satisfy the full milestone.

### M3 — Teaching preparation and session interface
Goal: prepare real conversation UI without fake voice. Owner: A with C. Effort: 2–3 hours. Dependencies: M2 and conversation contracts. Status: **Not started**.
Files: preparation/study/microphone/session/transcript components, study CSS and lifecycle tests.
- [ ] M3.1 Concise preparation with editable title/objective and optional notes (30–45 min).
- [ ] M3.2 Freeze objective on teaching start and preserve it on retry (30 min).
- [ ] M3.3 Parameterize connection, activity, mute, unavailable/error controls (45–60 min).
- [ ] M3.4 Correct latest-turn presentation; keep transcript and lower text fallback (30 min).
- [ ] M3.5 Finish & Review/ending states; verify mobile/keyboard behavior (30–45 min).
Acceptance: preparation/teaching are navigable, accurately unavailable before integration, and ready for real events.

### M4 — Results and retry foundation
Goal: support structured feedback and linked attempts. Owners: A/C; B fixtures. Effort: 2–3 hours. Dependencies: M2/contracts; can overlap M3. Status: **Not started**.
Files: Results, concept/attempt UI, future summary/sample preview, fixture, evaluation state.
- [ ] M4.1 Concise summary, covered/gap groups, priority recommendation (45 min).
- [ ] M4.2 Collapse detailed concept evidence and transcripts (30 min).
- [ ] M4.3 Keep sample evaluation in an isolated collapsed development preview (15–30 min).
- [ ] M4.4 Unavailable/pending/error/ready evaluation rendering and state (30–45 min).
- [ ] M4.5 Explain again, same lesson/objective, earlier attempt navigation (30–45 min).
- [ ] M4.6 Verify real/sample evidence labels and absence of fabricated feedback (15–30 min).
Acceptance: typed evaluations render and retries preserve attempts; real/sample results cannot be confused.

### M5 — Independent API verification
Goal: prove services and select one architecture early. Owners: A ElevenLabs, B Gemini, C secure endpoints. Effort: 3–4 hours across team. Dependencies: M1 plus usable credentials/configuration. Status: **Not started**.
Files/modules when needed: server provider adapters, bounded HTTP handling, student instructions, evaluation schema/fixtures and verification notes.
- [ ] M5.1 Verify Gemini connectivity and structured sample evaluation (30–45 min).
- [ ] M5.2 Verify custom-description objective/assessment generation (30 min).
- [ ] M5.3 Verify private ElevenLabs connection and a real spoken response (45–60 min).
- [ ] M5.4 Check Gemini agent configuration, lesson variables and student behavior (30 min).
- [ ] M5.5 Test interruption, tentative/final messages, roles and final history retrieval (45–60 min).
- [ ] M5.6 Measure startup/turn/finalization latency; record architecture choice (30 min).
Acceptance: both providers work independently and the team selects one realistic pipeline. Account/API failures are blockers, not mock successes.

### M6 — Live teaching conversation
Goal: enable verbal explanation and relevant spoken follow-up questions. Owner: A with C; B owns instructions. Effort: 4–6 hours. Dependencies: M3, verified M5 architecture. Status: **Not started**.
Files/modules when needed: browser adapter, conversation hook, voice routes, controls/state.
- [ ] M6.1 Server-issued credentials and adapter startup (45–60 min).
- [ ] M6.2 Permissions, mute, disconnect and real state events (45–60 min).
- [ ] M6.3 Inject lesson context and curious-student behavior (30–45 min).
- [ ] M6.4 Normalize roles, IDs, ordering and transcript corrections (45–60 min).
- [ ] M6.5 Finalize transcript with bounded waiting/incomplete handling (45–60 min).
- [ ] M6.6 Test permission denial, interruption, drop and complete conversation (45–60 min).
Acceptance: real interactive conversation with reliable retained learner/student transcript.

### M7 — Gemini evaluation engine
Goal: evaluate conceptual understanding rather than speaking style. Owner: B with C. Effort: 4–6 hours. Dependencies: M1 and Gemini M5 proof; can overlap M6. Status: **Not started**.
Files/modules when needed: lesson assessment, transcript evaluation, schema, routes, representative fixtures/tests.
- [ ] M7.1 Generate scoped custom assessments; retain curated baselines (45–60 min).
- [ ] M7.2 Stable concept IDs and fixed assessment/version for retries (30–45 min).
- [ ] M7.3 Evaluate learner statements; student turns provide context only (45–60 min).
- [ ] M7.4 Coverage, misconceptions and priority retry guidance (45 min).
- [ ] M7.5 Validate shape, concepts, versions and learner evidence references (45–60 min).
- [ ] M7.6 Test complete/incomplete/incorrect/student-supplied-answer cases (45–60 min).
Acceptance: defensible structured feedback for representative cases; malformed/unsupported output is rejected.

### M8 — Complete Feynman learning loop
Goal: finish the primary hackathon MVP. Owner: C integration with A/B. Effort: 3–4 hours. Dependencies: M4, M6, M7. Status: **Not started**.
Files: finish/finalization flow, evaluation client/routes, state, real Results, comparison.
- [ ] M8.1 Finalized transcript → evaluation once, with error recovery (45–60 min).
- [ ] M8.2 Display real feedback/priority next step (30–45 min).
- [ ] M8.3 Retry same objective/assessment without overwriting attempts (30 min).
- [ ] M8.4 Compare concept coverage only for matching assessments (45 min).
- [ ] M8.5 Verify full custom-lesson flow and failed-request retry (45–60 min).
Acceptance: teach → be challenged → feedback → reteach → observe improvements without developer intervention.

### M9 — Usability and optional enhancements
Goal: add supporting value without delaying M8. Owners: A/C; B notes review. Effort: 0–2 hours initially. Dependencies: M8 unless a specific independent slice is approved. Status: **Not started** (optional).
Files: lesson form, transcript, optional versioned local persistence; workspace UI only if separately approved.
- [ ] M9.1 Capped pasted notes if not already approved earlier (30–45 min).
- [ ] M9.2 Optional local recent-lesson/completed-attempt history (45–60 min).
- [ ] M9.3 Transcript readability and first-use guidance (30–45 min).
- [ ] M9.4 Assess lightweight grouping; do not implement full workspaces (15–30 min assessment).
Acceptance: selected enhancements are verified and do not destabilize M8. Deferred tasks remain unchecked.

### M10 — Testing, polishing and presentation
Goal: a reliable demo with a real-session fallback recording. Owner: all, C coordinates. Effort: 3–4 hours. Dependencies: M8; deployment/audio checks can start after M6. Status: **Not started**.
Files: tests, localized fixes, configuration, README and presentation artifacts.
- [ ] M10.1 Repeat real core sessions and fix critical bugs (45–60 min).
- [ ] M10.2 Permissions/API failures/interruption/refresh recovery checks (45 min).
- [ ] M10.3 HTTPS microphone behavior on actual demo laptop (30–45 min).
- [ ] M10.4 Final build/lint/tests and accessibility checks (30 min).
- [ ] M10.5 Rehearse 2–3 minute demo; record real successful session (30–45 min).
- [ ] M10.6 Screenshots/docs and major-feature freeze (30 min).
Acceptance: repeatable complete demo and working recorded fallback.

## Parallel work and time budget

After approved M1: A can refine UI and verify ElevenLabs; B can prototype Gemini; C can build endpoints/lifecycle. M5 should start early, before all frontend polish is finished. M7 can overlap M6; M8 needs both plus M4. Parallelism is not automatic permission to advance tasks.

Submission deadline: Sunday October 11, 2026 at noon; timezone unconfirmed. Aim for a working M8 loop Saturday evening and feature freeze Sunday morning. Cut M9 first if time is short.

## Historical pre-pivot project state

- Latest completed approved task: **M2.1 — homepage heading/copy refinement**. Implementation stopped; awaiting approval for another task. M2 as a whole is blocked on the missing lesson contracts/state migration.
- Recently completed foundation: three routes, curated topics, text fallback, draft protection, sample feedback isolation, retries, larger microphone and responsive UI. These are prior foundation features, not completion of M2–M8.
- This session: guide created and read (M1.1); homepage heading updated, marketing/process copy removed, introduction spacing reduced, suggested-topic heading and integration notice simplified (M2.1).
- Approved M2.1 copy follow-up: removed “Understanding starts with explaining.” and “Built around the Feynman Technique” from the shared footer in `AppLayout.tsx`. Complete; `npm run typecheck` and `npm run lint` passed for this change.
- Integration status: ElevenLabs/Gemini not implemented or independently verified; voice controls disabled; no recording or real evaluation.
- Blockers/dependencies: M1 lesson/assessment contracts and M2.4 state migration are missing for arbitrary-topic creation. Provider credentials/configuration/quota and deadline timezone are unconfirmed.
- Verification in this session: `npm run build` passed (including TypeScript); `npm run lint` passed; `npm test` passed all 3 tests. Production-preview browser checks passed: the homepage heading/copy, compact introduction and no overflow at 320/390/768/1440px; WCAG A/AA automated scans; keyboard activation of all three topic actions and preparation navigation; no browser runtime errors. Desktop/mobile screenshots reviewed. Browser-check tooling was already available outside the repository; no dependencies were installed. M1.5 remains pending for verification after the remaining contract tasks.
- Next recommended task: M1.2 contract agreement, followed by M1.3–M1.4 and M2.4 lesson state to enable functional M2.2 form work. Ask for approval before starting it.

## Scope boundaries

Required MVP: custom topic entry, preparation, real AI student conversation, real transcript, Gemini evaluation, feedback and linked retry.

Secondary/optional: pasted notes, local history, simple matching-concept comparison refinements. Workspaces are optional collections, never prerequisites to creating a lesson.

Deferred: full workspaces, PDF/document ingestion, accounts, database/cloud persistence, Presage, complex analytics, elaborate avatars, flashcards/course management and unrelated assistant tools.
