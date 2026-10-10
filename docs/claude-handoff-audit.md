# feynman.ai — Uploaded ZIP code audit and Claude Code handoff

**Date:** 2026-10-10  
**Source of truth:** user's uploaded `feynman.zip`, not the older GitHub `main` snapshot.  
**Scope:** static code review and tooling checks only; **no application source edited** and **no live Gemini/ElevenLabs calls** made.  
**Files delivered:** new root `CLAUDE.md`, rewritten concise root `AGENTS.md`, and archived former guide `docs/AGENTS-legacy-2026-10-10.md`.

## Executive finding

The codebase is **not a write-off**. Stage 1 has useful backend-integrated assessment functionality. What makes the app feel unfinished is a split between (`/preview`) polished fixture-driven flows, (`/`) live homepage/baseline integration, and the legacy live teaching/results presentation. Completing a local end-to-end non-voice test path is a better immediate milestone than a new UI or architecture rewrite.

## Verified directly from code

1. **Current routes:** `src/app/App.tsx` mounts real `/`, `/study/:sessionId`, `/results/:sessionId`; the `/preview/:screen?` lazy route sits outside `SessionProvider`.
2. **Backend Stage 1:** `server/routes.ts` includes create/load/update/prepare/submit/pause/resume/voice/recheck/finish plus conversation registration/finalization. `src/components/practice/AssessmentView.tsx` is used in live `StudyPage.tsx`. `server/developmentProviders.ts` supplies explicit, deterministic mock arithmetic, only in development/test mode.
3. **Mock stops before recheck UI:** `src/features/study/StudyPage.tsx` branches on `session.providerMode === 'mock'` at teaching, rendering a message rather than a next/recheck action. Yet `POST /api/sessions/:id/recheck` already exists, and the assessment component supports recheck. **P0 is to connect that missing path in a transparently test-only manner, then verify results.**
4. **Voice exists as an unverified integration:** `TeachingPanel` uses `@elevenlabs/react`, signed URL requests, and server conversation endpoints, but there's no evidence in this ZIP of a successful real audio-to-results browser run. `GET /api/health` reports configuration booleans, not connectivity.
5. **Text fallback isn't independent:** The `Send to Alex` button is disabled unless `voice.status === 'connected'` (`StudyPage.tsx`). There is no actual text-only transport.
6. **Transcript race:** `onDisconnect` triggers best-effort `finalizeConversation(...).catch(() => undefined)`; clicking recheck calls `endSession()` and moves to recheck without awaiting the final transcript. The `/finalize` API only treats provider status `done` as complete; otherwise it leaves the segment pending without retry. Thus transcripts can be missing or incomplete, even while the learner progresses.
7. **Data is not durable:** `server/store.ts` uses `Map` with `structuredClone`. API process restart destroys sessions. Browser-side snapshots and drafts do not reconstruct the private server blueprint. Concurrent requests are not serialized by durable atomic operations.
8. **Gemini request pressure:** `server/routes.ts` grades each answered question independently in `Promise.all`; `server/providers.ts` uses one generation call for three paired concepts. A complete three-question baseline + recheck may trigger up to seven Gemini calls before retries. Quota failures are a known risk; batching requires accuracy tests.
9. **Real score rendering:** `ResultsPage.tsx` reads `session.attempts` grades, concept results, answers, and conversation objects. It is *not* simply the fixture-driven `PreviewResults`, but is unverified through a full live session.
10. **Scope drift and documentation:** Former `AGENTS.md` mixed newer Stage 1 instructions with obsolete M/R roadmaps and contradicted the live `MemorySessionStore` in at least one place. The rewritten root guide has a single active priority; the old instructions were archived verbatim.

## Tooling evidence and limitations

- Package: React 19, TypeScript, Vite, React Router, Node HTTP API, `@elevenlabs/react`, `tsx` tests; Node >=22.12 (`package.json`).
- **TypeScript:** `node node_modules/typescript/bin/tsc -b` — passed in the review environment.
- **ESLint:** `node node_modules/eslint/bin/eslint.js .` — passed with no output in the review environment.
- **Tests:** attempted `tsx --test tests/*.test.ts`, but tests couldn't execute because the ZIP's Windows-installed `node_modules` contains a Windows-only `esbuild` binary while this review ran on Linux. This is a *platform dependency mismatch*, not evidence of test assertion failure. The prior OpenCode report of 16 passing tests is **unverified in this environment**.
- **Build:** not claimed as rerun successfully; an OS-specific Rollup/esbuild install is required before an independent build here. OpenCode's reported passing build remains an earlier claim.
- **Browser/voice:** no new browser automation, Gemini quota, microphone, or ElevenLabs agent test in this review.
- **Security:** uploaded archive contains `.env` with nonempty configuration values. Neither new documentation nor the deliverable bundle includes any secret values. Do not send original archive publicly; if credentials have been exposed outside a trusted channel, rotate them.

## Priority work plan (one vertical slice per task)

| Order | Task | Clear done condition |
| --- | --- | --- |
| **P0** | Enable explicitly labeled mock teaching bypass; wire recheck/results; end-to-end mock tests | Run a complete simulated-assessment flow with actual API responses and no provider charges, including both grades and results |
| **P1** | Independent text conversation | User can converse with Alex without mic/voice service; mock and real paths are honestly labeled; tests cover recovery |
| **P2** | Real ElevenLabs speech + transcript reconciliation | Real agent works, context arrives, text gets persisted or shows recoverable incomplete status; no claims based on unverified callback behavior |
| **P3** | Production hardening | Batch/retry/idempotency/durability/rate-limits/deployment only after P0–P2 are verified |

P1/P2 order can change based on voice-agent availability; **P0 should happen first** because it proves baseline, follow-up and results are coherently wired, for free. A *mock teaching bypass* must be labeled as testing infrastructure rather than presented as a full Feynman experience or a demo of Alex.

## How to proceed in Claude Code

1. Use the **original local project directory**, not an exported ZIP, so `git status`, history, and uncommitted changes remain intact.
2. Copy the delivered root `CLAUDE.md` and `AGENTS.md` into that folder; add the audit and archived original into `docs/`. Inspect the diff before committing yourself.
3. Start Claude Code in the repo root. The top-level `CLAUDE.md` imports `AGENTS.md`. Ask Claude to check status and tests, then implement **P0 only**, providing before/after behavior and test evidence.
4. After one full mock cycle actually works, configure the private Alex ElevenLabs agent and address the speech and transcript lifecycle as a separate verified task. Keep real provider calls opt-in.

## Suggested first task for Claude Code

> Read `CLAUDE.md`, `AGENTS.md`, and `docs/claude-handoff-audit.md`. Inspect the current git diff and confirm the mock Stage 1 flow. Implement **P0 only**: a clearly labeled DEV MOCK teaching bypass into the existing `/recheck` endpoint, recheck rendering and submission, actual API-backed mock-grade results, and a test that traverses creation through finish. Preserve the real ElevenLabs route and `/preview`. Do not use or change API keys, don't call external models, don't redesign anything, and don't commit/push. Run typecheck/lint/tests/build and report exact results and any environment limitations. Stop after P0.
