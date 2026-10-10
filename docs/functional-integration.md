# Functional integration — Stage 1 review checkpoint

Completed October 10, 2026. **Stopped for review after baseline assessment integration.** Stage 2 conversation integration and Stage 3 reliability/deployment work remain approval-gated.

## Initial audit

The working tree already contained modified `AGENTS.md`, `README.md`, and `src/app/App.tsx`, plus untracked `docs/frontend-redesign.md` and the entire `src/features/preview/` feature. Those changes were inspected and preserved. No staging, commits, dependency changes, key changes, pushes or deployments were performed.

- Reusable preview presentation: controlled `AssessmentView`, icons, scoped CSS, dashboard form and sidebar layout. Question/answer props already matched the public assessment contracts.
- Fixture-dependent preview components: dashboard history rows, assessment transition timers/state tools, conversation messages/status controls, results/comparisons and `previewFixtures.ts`. These remain preview-only; live routes do not import fixture content.
- Existing backend: create/load/update sessions; Gemini preparation/clarification and per-question grading; pause/resume; focused voice credentials; conversation registration/history; matched recheck; finish/results. Real adapters were present but were not called during this task.
- Existing browser foundation: one `SessionProvider`, browser snapshots/access tokens, debounced draft PATCH requests and per-session client queues. Server sessions use `MemorySessionStore`, not durable storage.
- Missing/broken Stage 1 interactions: no live assessment Back action; interrupted evaluation without a stored provider error had no retry action; draft sync status was not exposed; completed submission retries failed the stage guard; cached missing-server sessions stayed editable.
- Contract gaps: preview submission wording/callbacks needed live busy-state binding; provider source was absent from session/health responses; question-index PATCH allowed navigation changes outside the assessment stage. These were addressed without replacing the domain model.
- Older UI remaining: actual teaching conversation and Results content. Legacy topic-centric preparation/text/evaluation components and contracts remain historical compatibility code. They do not supply live assessment questions or grades.

Baseline: typecheck/build passed, 8 tests passed, lint had one existing cleanup-ref warning. Build had the existing large live-bundle advisory.

## Implemented and verified

The approved dashboard/sidebar and assessment presentation now use the real session API and the existing domain store. Topic/notes submission creates a session and starts preparation. Server-generated questions, clarification, preparation loading/retry, answer/working fields, back/next, uncertainty, explicit skips, pause/resume, optional pre-practice self-report, grading loading/failure/retry and the teaching transition are wired.

Drafts distinguish browser-local, syncing and server-saved states. Failed draft sync can be retried. Reload restores local fields and reconciles server state. Missing/inaccessible server sessions show read-only browser drafts and a fresh-start action. Browser refresh recovery still requires the original API process; restarting it clears server sessions.

Repeated clicks share the pending client action. Repeating an already completed submission returns its stored grade without grading again. This is **not** cross-client/in-flight server locking; that remains Stage 3.

The mock teaching screen explicitly marks the Stage 1 boundary and disables provider conversations. The normal provider path retains the existing teaching implementation. No new conversation lifecycle or text-only engine was implemented.

## Explicit development provider mode

Two terminals, from the repository:

```powershell
# Terminal 1 — set these before starting the API
$env:NODE_ENV = 'development'
$env:PRACTICE_PROVIDER_MODE = 'mock'
npm run dev:server
```

```powershell
# Terminal 2
npm run dev
```

Open Vite's printed URL, normally `http://localhost:5173/`. `/preview` still works independently without the backend and never accesses API, storage or microphone services.

Mock selection is backend-only and explicit. `NODE_ENV` must be exactly `development` or `test`; production, unspecified environments and unknown modes fail closed. Real is the default provider mode. Existing server credentials do not cause calls in mock mode. Health/session metadata and visible banners/history/grade labels identify `DEV MOCK`, never Gemini.

Mock question generation always supplies fixed arithmetic questions, regardless of submitted topic/notes. Baseline answers are `5`, `12`, `4`; follow-up fixtures have different matched prompts. A matching numeric answer earns one fixture point, and adding nonempty working earns a second; wrong answers and skips earn zero. This tests wiring, not educational grading quality. Expected answers/rubrics/reserved questions stay private until the appropriate assessment is issued. Mock voice/history throw explicit unavailable errors without provider requests.

Optional environment controls, set before restarting the API:

| Variable | Values |
| --- | --- |
| `MOCK_PROVIDER_SCENARIO` | `normal` (default), `clarification`, `prepare-error-once`, `grade-error-once` |
| `MOCK_PROVIDER_DELAY_MS` | Integer 0–10000; default 350 |

Failure scenarios fail once per API process, then permit retry. For normal real-provider operation set `PRACTICE_PROVIDER_MODE=real` and configure private Gemini/ElevenLabs keys. No real requests were made or authorized in this task.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, zero warnings; the existing cleanup-ref warning was fixed in the touched provider |
| `npm test` | 16 passed (8 original + 8 new), no failures |
| `npm run build` | Pass; existing >500 kB live-chunk advisory remains |
| Browser | Pass with external Playwright/Edge/axe tooling against Vite and the actual Node API using mock providers |

Browser checks covered keyboard start, validation, preparation/clarification, question rendering/navigation, working and uncertainty, server saves, pause/resume, refresh, skipping, actual endpoint grading and focus selection, simulated preparation/grading errors and retry, aborted draft sync, lost grading response, backend restart and read-only recovery. Live Home/assessment passed overflow and WCAG A/AA scans at 320/390/768/1440 px; teaching/error checkpoints also passed scans. All six preview views passed scans at 320/1440 px. Preview produced no API requests and left seeded live storage unchanged. No browser runtime errors, real provider requests or microphone requests occurred.

Browser script and screenshot: `C:/Users/fahim/AppData/Local/Temp/opencode/feynman-browser-check/stage1-check.mjs` and `stage1-baseline-desktop.png`. No browser dependency was added to the project. Baseline screenshot was inspected. These are local verification artifacts, not a new repository test framework.

## Files changed in this task

- Setup/documentation: `.env.example`, `AGENTS.md`, `README.md`, `docs/functional-integration.md`, `docs/frontend-redesign.md`.
- Backend/contracts: `server/developmentProviders.ts` (new), `server/providers.ts`, `server/routes.ts`, `shared/types.ts`.
- Shared approved presentation: `src/components/AppLayout.tsx`; new `src/components/practice/AssessmentView.tsx`, `PracticeIcon.tsx`, `StartPracticeForm.tsx`, `practice.css`.
- Live frontend: `src/features/topics/HomePage.tsx`, `src/features/study/StudyPage.tsx`, `src/services/practiceApi.ts`, `src/state/SessionProvider.tsx`, `src/state/sessionReducer.ts`, `src/state/useSessions.ts`.
- Preview reuse adapters: `src/features/preview/AssessmentView.tsx`, `PreviewIcon.tsx`, `preview.css`, `PreviewDashboard.tsx`, `PreviewAssessment.tsx`. Original shared content was promoted with compatibility imports; fixture orchestration remains isolated.
- Tests: `tests/stage1.test.ts` (new), `tests/sessionReducer.test.ts`.

`src/app/App.tsx` remains the user's pre-existing uncommitted route change; it was not edited in this task. Preview files, fixtures, other UI components and provider adapters were not discarded.

## Next review decision — Stage 2

Smallest next task: review this API-backed baseline in mock mode. After approval, verify/configure the private ElevenLabs agent and integrate the designed conversation presentation with real connection/microphone events, weak-concept context, finalized transcript reconciliation and an independent text-only alternative. Then connect matched follow-up presentation and actual before/after Results. Request permission separately before spending provider credits.

Blockers to a verified real full session: Gemini quota/availability and permission for live calls; private ElevenLabs credentials/agent configuration and real audio verification; incomplete disconnect/history synchronization; no independent text-only conversation; remaining older teaching/results presentation; process-memory-only backend sessions.

## Stage 3 plan — not implemented

1. **Batch grading:** one bounded structured provider request for three responses, while validating each question's rubric, expected answer, exact evidence and deterministic totals. Verify equivalence on complete/partial/incorrect/skipped cases.
2. **Quota/timeouts:** distinguish 429/503/timeouts, align browser/server deadlines, add bounded deliberate retries and usage visibility without discarding answers or automatic credit-consuming retry loops.
3. **Operation protection:** persistent idempotency keys, atomic stage transitions and recovery for concurrent prepare/submit requests across tabs/processes. Test in-flight repeats and crashes; client queues are insufficient.
4. **Persistent sessions:** implement the existing `SessionStore` boundary using durable Postgres records, including private blueprints, hashed access references, attempts and operation state; agree ownership and retention first.
5. **Vercel compatibility:** select the documented Node server entrypoint or function-handler deployment, configure SPA/API routing and duration budgets, and avoid relying on process memory for continuity. Keep provider credentials server-side and browser voice connections separate from request handlers. No configuration/deployment changes made.
6. **Supabase compatibility:** design session ownership, private blueprint tables and transactional updates. Enable ownership-based row-level security for browser-accessible data. Keep administrative secret/service-role keys on the server and enforce access there when using privileged clients. No database/SDK setup performed.
7. **Public beta controls:** agree authentication/access policy, per-user/session/IP request limits, provider spending caps, input/output limits and secret/log handling before public deployment. Verify mock mode cannot start in production and private/reserved content is inaccessible.

Deployment planning consulted current [Vercel Node runtime docs](https://vercel.com/docs/functions/runtimes/node-js) and [Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security). All Stage 3 items require separate approval and verification.

## P0 checkpoint — DEV MOCK full cycle (2026-10-10, Claude Code)

- **Works:** in mock mode the teaching stage shows a labeled `DEV MOCK: skip teaching (test only)` button that calls the existing authenticated `POST /recheck`. The existing live `AssessmentPanel` renders the matched recheck questions, submit/grading goes through the existing `/submit` path, and `/results/:id` shows the server-stored baseline and recheck grades with DEV MOCK labels. No conversation or transcript is created.
- **Server:** `/recheck` now also requires an active (not paused) session.
- **Tests:** `tests/stage1.test.ts` adds an API full-cycle test (create → prepare → baseline → grade → bypass → matched recheck → grade → results → refresh → after rating → finish). 17/17 tests pass.
- **Browser smoke:** run manually in the desktop app's browser pane against a mock-only API (`NODE_ENV=development PRACTICE_PROVIDER_MODE=mock`, `.env` not loaded). The full path through to Finish and the Home "Completed 1/6 → 4/6" entry worked, and so did refreshing the teaching and results pages. **There is no automated browser test yet** because the repo has no browser test runner, and adding one is a dependency decision.
- **Unchanged and unverified:** real ElevenLabs teaching, the real Gemini recheck, the text-only path (P1), and transcript reconciliation (P2).
