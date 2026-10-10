# feynman.ai — Current engineering contract

**Updated: 2026-10-10.** Source of truth for agents working on this repository. The original 33 KB roadmap was archived, unaltered, at [`docs/AGENTS-legacy-2026-10-10.md`](docs/AGENTS-legacy-2026-10-10.md) because it contained conflicting and superseded checkpoints. This file supersedes its instructions. `docs/functional-integration.md` contains the last OpenCode Stage 1 verification notes; `docs/claude-handoff-audit.md` records this uploaded-repository review. For Claude Code, also read `CLAUDE.md`.

## Product and definition of done

**feynman.ai** is a low-pressure educational study app inspired by the Feynman Technique: the learner describes already-studied material, answers three baseline questions, explains weak concepts to Alex (an AI classmate), answers three matched follow-up questions, and receives a fair before/after comparison. Optional pre/post nervousness ratings are **self-report only**; there are no diagnostic or anxiety-reduction claims.

The **near-term milestone** is ONE correctly implemented local study cycle, not a prettier preview, broader product scope, durable infrastructure, or deployment:

`topic + optional notes → prepare (or clarify) → baseline (3 questions) → grade → teaching → matched recheck (3 questions) → grade → actual results`

Separate **code exists**, **tested with development mocks**, and **verified with real providers**. Never call a feature complete based solely on its presence in JSX, an API route, or a mocked screenshot.

## Current state: uploaded ZIP audit (2026-10-10)

| Area | Grounded status | Key files |
| --- | --- | --- |
| Live home + first assessment | Stage 1 integrated with backend; save/skip/uncertainty/back/next/pause and retry paths exist | `src/features/topics/HomePage.tsx`, `src/components/practice/`, `src/features/study/StudyPage.tsx`, `src/state/SessionProvider.tsx` |
| Preparation + baseline grading | Server/provider implementations present. Gemini was checked previously in limited calls; no new live call during this audit | `server/routes.ts`, `server/providers.ts`, `server/domain.ts` |
| DEV MOCK | Explicit, backend-only, deterministic arithmetic, fail-once scenarios; voice/history disabled | `server/developmentProviders.ts`, `tests/stage1.test.ts` |
| Teaching voice | Existing ElevenLabs SDK hook + credential/registration/history endpoints, but a real spoken full cycle has **not** been verified | `src/features/study/StudyPage.tsx`, `server/providers.ts`, `server/routes.ts` |
| Text alternative | Current `Use text instead` requires an **active voice connection**; not a standalone fallback | `src/features/study/StudyPage.tsx` |
| Recheck + results | DEV MOCK full cycle (labeled test-only teaching bypass → matched recheck → mock grades → Results → finish) verified by API test and a manual browser run (P0, 2026-10-10). Real-provider recheck/results are still unverified | `server/routes.ts`, `src/features/study/StudyPage.tsx`, `src/features/feedback/ResultsPage.tsx` |
| Preview | Separate attractive but sample-data-only `/preview`; not the live learning loop | `src/features/preview/` |
| Persistence | Browser drafts and access references exist; API sessions are in a process-local Map. Restart **loses** sessions | `src/state/SessionProvider.tsx`, `server/store.ts` |

Last OpenCode checkpoint reported typecheck/lint/build passing, 16 tests passing and Stage 1 browser checks. **In this ZIP audit** TypeScript typecheck and lint passed; test execution here was blocked by archived Windows-only esbuild binaries under `node_modules` when run on Linux, not by an observed application assertion failure. Run `npm ci` on the target machine if dependencies are incompatible.

## Next implementation order — small, reviewable vertical slices

### P0 — Complete the full **mock** non-voice flow (first)

**Why:** The server supports `/recheck`, but the live UI deliberately stops at a `DEV MOCK` teaching checkpoint. That means baseline-to-results cannot be tested without real provider access.

Implement a **test-only, explicitly labeled teaching bypass** available solely when `session.providerMode === 'mock'` (never present a pretend teaching conversation as real). Use the existing authenticated recheck action. Connect the existing live `AssessmentView` to recheck questions, submit/grading/retry and `ResultsPage`, keeping all `DEV MOCK` labels on results and history. Reuse the existing API/state/contracts; do not create another session store.

**Acceptance:** With no real credentials or network calls, a user can navigate topic → baseline → mock grading → labeled teaching bypass → matched recheck → mock grading → genuine server-backed (but clearly mock-graded) Results; refresh/error/skip paths still work. Add API integration coverage from create through finish and a browser smoke test. No secret keys needed and no fake transcripts.

### P1 — Independent text-only teaching path (after P0)

Implement an actual text-conversation mode **without microphone, ElevenLabs, or signed voice URL requirements**. Design a bounded server-backed provider interface that supports the existing weak-concept context, meaningful one-question-at-a-time teaching, per-turn history and explicit mock-vs-real labels. Reuse existing session and transcript contracts as appropriate; avoid a second conflicting domain store. In mock use deterministic scripted *clearly identified test messages*; in real mode use an approved provider, subject to rate limits and approval for credits. Test input validation, interruptions, and recovery. Do not call a disconnected ElevenLabs WebSocket a "text fallback."

**Acceptance:** An ordinary user can actually type an explanation and receive relevant responses, even when microphone permission is denied. Test mode makes no provider calls; real behavior is verified only with explicit permission.

### P2 — Real ElevenLabs voice and transcript lifecycle (after P0; can be developed separately from P1)

Verify a private Alex agent with configured dynamic variables `session_id`, `session_title`, `focus_context`, `opening_question`. Keep `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` backend-only. Use the existing `@elevenlabs/react` conversation hook and server-issued signed URL. Map real connect/error/listening/speaking/mute/disconnect events honestly.

**Known issue:** The current onDisconnect handler fires one best-effort finalization and discards errors. It may fetch history before ElevenLabs has finished processing; `startRecheck` does not await final transcript readiness. Implement bounded status-aware retry/reconciliation and explicit `pending`/`incomplete`/`ready` UI, with a recoverable action after navigation/refresh. Do not block all study progress indefinitely for third-party history, but do not label an incomplete transcript 'saved.' Verify permission denial, disconnect, restart and duplicate callbacks.

**Acceptance:** Real spoken conversation with relevant concept prompts; transcripts persist and can be re-retrieved, with truthful status and no fabricated turns. Real verification requires permission for provider calls.

### P3 — Reliability after one full cycle is demonstrated

- Gemini: a baseline and recheck currently grade each non-skipped response independently via `Promise.all`; consider bounded batch grading to reduce quota/cost **only with validated per-question evidence and consistent 0–2 scoring**.
- Handle 429/503/timeout distinctly, bound retries, avoid duplicate cost-bearing in-flight requests and preserve submitted answers.
- Add durability (`SessionStore` backed by persistent storage) before production/serverless hosting; a browser local draft does not restore a restarted backend.
- Add resource caps, authorization/rate limits, usage monitoring, secret isolation and provider budget protection before public beta.
- Test the complete deployed flow only after local functionality works. Vercel deployment cannot simply rely on the current in-memory Node process.

## Architectural map

- **Frontend:** React 19 + TypeScript + Vite + React Router. Live `/`, `/study/:sessionId`, `/results/:sessionId`; isolated lazy `/preview/:screen?`.
- **Presentation:** `src/components/practice/` shared assessment primitives; legacy live conversation/results presentation in `src/features/study/` and `src/features/feedback/`.
- **Browser state:** `src/state/SessionProvider.tsx`, `useSessions.ts`, reducer; `src/services/practiceApi.ts` fetches `/api` routes.
- **Shared contract:** `shared/types.ts`; use `PracticeSession`, `PracticeCycle`, `AssessmentAttempt`, provider mode, lifecycle/stages. Avoid changing contracts without tests and coordinated updates.
- **Backend:** `server/index.ts`, `server/routes.ts`, `server/domain.ts`, `server/providers.ts`, `server/developmentProviders.ts`, `server/store.ts`. Questions' expected answers, rubrics and reserved rechecks stay in private blueprints, never client JSON.
- **Tests:** `tests/*.test.ts`, including `tests/stage1.test.ts`; use Node's test runner via `npm test`.

## Development commands

Node >=22.12 and package scripts in `package.json`:

```powershell
# Terminal 1 — explicitly isolated mock API (development only)
$env:NODE_ENV = 'development'
$env:PRACTICE_PROVIDER_MODE = 'mock'
npm run dev:server

# Terminal 2 — Vite frontend
npm run dev
```

The live app is `/`; `/preview` is isolated sample UI. Without `PRACTICE_PROVIDER_MODE=mock`, **real is the default** and API calls may spend Gemini/ElevenLabs credits. To test a known mock error set `MOCK_PROVIDER_SCENARIO=prepare-error-once` or `grade-error-once` before restarting API; refer to `docs/functional-integration.md` for options.

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Do not treat a passing unit test as proof of live ElevenLabs connectivity. Do not run real provider calls, automated browser tests that hit real providers, or make deployment/billing changes without explicit permission. If dependency binaries originate from another OS, reinstall with `npm ci` on the current machine before attributing runtime loader errors to code.

## Safety, teamwork and change control

1. Check `git status --short` and `git diff` **before touching files**; preserve all uncommitted teammate work. Never auto-commit, push, force, merge, or deploy. Keep changed files tightly scoped.
2. Favor a single agent for shared `server/routes.ts`, `shared/types.ts`, `SessionProvider.tsx` changes. Parallel agents may inspect/review, but simultaneous edits require isolated worktrees and file ownership.
3. Do not expose API keys, bearer session tokens, signed URLs, reserved questions, private blueprints, or user notes/transcripts in logs, screenshots or answers. The original uploaded ZIP included a populated `.env`; **never republish that ZIP**.
4. Keep mock mode explicitly non-production (`NODE_ENV=development|test`) and source-labeled in every relevant live view. Never pass mock scores off as Gemini grades. Maintain user-facing recovery messages and preserve drafts on failures.
5. Do not make health diagnosis/treatment claims or infer emotional state from quiz grades. Report optional nervousness as user-provided data only.
6. Separate code behavior, test evidence and open hypotheses in every report. Do not rewrite architecture, install frameworks, or redesign screens to avoid a small integration issue.
7. When the user gives an implementation task, carry out that **approved task** and then stop at a demonstrable checkpoint; don't impose historical approval gates or autonomously expand into unrelated stages.

## Task completion template

Record: **goal / exact changed files / behavior now working / mocked or unverified pieces / checks run and pass/fail / next smallest task**. Keep `docs/functional-integration.md` and this checkpoint current only when corresponding code is actually changed. The archived roadmap is historical and should not be modified.
