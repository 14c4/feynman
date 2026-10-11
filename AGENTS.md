# feynman.ai — Project guide for coding agents

Read this first. It describes what exists today, how the code is organized, and how to work in it. `CLAUDE.md` adds Claude-specific notes. Older roadmaps and audits in `docs/` are historical context, not instructions.

## Product vision

feynman.ai is a study app built on the **Feynman Technique**: you understand something when you can explain it simply. The learner is the teacher; **Alex**, an AI classmate, is the student who listens, asks curious questions, and exposes gaps. A short check before and after teaching shows what actually changed.

Core loop: `topic + optional notes/files → prepare 3 concepts → baseline (3 questions) → grade → teach Alex → matched recheck (3 new questions) → grade → results`.

It is an educational tool. Optional nervousness ratings are self-reported reflection only; never make diagnostic or treatment claims.

## What works today (implemented in code)

- **Session creation** — topic, description, notes, and up to 3 uploads (PDF/TXT/Markdown, 4 MB each, 8 MB total) with drag-and-drop. Text is extracted server-side (`unpdf`) and only bounded excerpts reach providers.
- **Preparation** — Gemini generates a title, scope and 3 concepts, or asks one clarification question. Expected answers, rubrics and reserved recheck questions stay in a private server blueprint, never in client JSON.
- **Assessments** — one question at a time with answer, optional working, "not sure" flag, skip, back/next, autosave (browser draft → debounced server PATCH), retry on failed save or grading. Each answered question is graded 0–2 by Gemini; skipped answers are not sent.
- **Teaching Alex** — two channels:
  - *Voice*: ElevenLabs agent via `@elevenlabs/react` with a server-issued signed URL and dynamic variables (`session_id`, `session_title`, `focus_context`, `opening_question`). Mic permission is requested before any signed URL. Transcripts are fetched from ElevenLabs history with bounded retry and honest `pending / ready / incomplete` status.
  - *Text*: standalone server-backed conversation (Gemini `alexReply`), no microphone needed, 30-turn cap, retry for a failed reply.
  - Alex avatar reflects real state (idle, connecting, listening, user speaking, thinking, responding, interrupted, ended); voice mode follows live audio volume.
- **Recheck and results** — matched follow-up questions on the same concepts, before/after comparison, per-concept outcomes, "practise again" prefill on Home, expandable question feedback and transcripts, optional after-rating, finish.
- **DEV MOCK mode** — deterministic arithmetic fixtures, scripted labeled Alex text replies, voice disabled, and a labeled *test-only* teaching bypass. Only allowed with `NODE_ENV=development|test`; every mock surface is labeled.

**Limits worth knowing:** sessions live in a process-memory `Map` (`MemorySessionStore`); restarting the API loses them. Extra practice cycles (`POST /cycles`) return 501. No auth, rate limiting or durable storage yet. Automated tests use mocks only; real Gemini/ElevenLabs behavior is verified manually.

## Architecture

| Area | Files |
| --- | --- |
| Routes / pages | `src/app/App.tsx` — `/`, `/study/:sessionId`, `/results/:sessionId` |
| Shell & navigation | `src/components/AppLayout.tsx`, `layout.css` (top bar; focus bar + stepper during study) |
| Home | `src/features/topics/HomePage.tsx`, `StudyComposer.tsx`, `home.css` |
| Study flow | `src/features/study/StudyPage.tsx` (prep, overview, assessment, teaching), `QuestionCard.tsx`, `AlexAvatar.tsx`, `alexState.ts`, `ConversationStatus.tsx`, `stages.ts`, `study.css` |
| Results | `src/features/feedback/ResultsPage.tsx`, `feedback.css` |
| Design system | `src/styles/tokens.css` (colors, type, spacing, motion), `global.css` (buttons, fields, cards, badges, notices), `components/Button.tsx`, `components/practice/PracticeIcon.tsx` |
| Browser state | `src/state/SessionProvider.tsx`, `useSessions.ts`, `sessionReducer.ts`; API client `src/services/practiceApi.ts` |
| Shared contract | `shared/types.ts` (`PracticeSession`, `AssessmentAttempt`, `PracticeCycle`, `ConversationSegment`, limits) |
| Backend | `server/index.ts`, `routes.ts` (all `/api` endpoints), `domain.ts` (validation, grading flow), `providers.ts` (Gemini + ElevenLabs), `developmentProviders.ts` (mock), `alex.ts` (persona/context), `materials.ts` (extraction), `store.ts` |
| Tests | `tests/*.test.ts` via Node test runner (`npm test`); `tests/stage1.test.ts` covers the full mock cycle |

Unused legacy components remain in `src/features/study/` and `src/features/feedback/` (e.g. `MicrophoneControl`, `StudentAvatar`).

**Server environment** (backend only; never `VITE_`-prefixed): `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-2.5-flash`), `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `PRACTICE_PROVIDER_MODE` (`real` default | `mock`), `MOCK_PROVIDER_SCENARIO` (`normal`, `clarification`, `prepare-error-once`, `grade-error-once`, `reply-error-once`), `MOCK_PROVIDER_DELAY_MS`, `PORT` (3001), `HOST`.

## Commands

Node ≥ 22.12.

```powershell
# Mock API (no credits spent). Without PRACTICE_PROVIDER_MODE=mock, real providers are used.
$env:NODE_ENV = 'development'; $env:PRACTICE_PROVIDER_MODE = 'mock'; npm run dev:server
npm run dev          # Vite frontend, proxies /api to PORT (default 3001)
```

```sh
npm run typecheck && npm run lint && npm test && npm run build
```

`dev:server` loads `.env` if present; run `npx tsx server/index.ts` with explicit env vars to guarantee no keys are loaded. If dependencies came from another OS, run `npm ci` before blaming the code.

## Design philosophy

- Modern, minimal, calm: inspired by Brilliant's learning clarity, Speak's conversational immersion and Linear's precision, with an original green identity.
- One primary action per screen; one question at a time; navigation recedes during a study session.
- The teacher/student relationship must be obvious: the user explains, Alex asks.
- Build from shared tokens and primitives, not per-page styling. Restrained motion that communicates state and respects `prefers-reduced-motion`.
- Responsive (phone → desktop), keyboard accessible, visible focus, labeled fields.
- Every visible control must work. No decorative buttons, fake data, fake transcripts, or artificial delays in the live app.

## Future direction (product context, not a task list)

None of these are implemented. Work on them only when the user asks.

- Longer and timed assessments; exam-style practice and better exam-readiness signals.
- Confidence tracking per answer and per concept over time.
- Presage SmartSpectra integration for optional camera-based physiological signals, and physiological insights shown alongside study results — framed as reflective data, not health diagnosis, and only with explicit user consent.
- Multiple practice cycles on weak concepts, durable storage, auth, rate limits and provider budget protection before any public deployment.

## Development guidelines

1. **Do the current task.** The user's request outranks this roadmap and any older plan in `docs/`. Don't expand scope on your own.
2. **Preserve working functionality.** Reuse existing state, services and contracts; don't rewrite working logic to fit a new idea. Change `shared/types.ts`, `server/routes.ts` or `SessionProvider.tsx` carefully and keep tests passing.
3. **Prefer small, direct changes** over new architecture, frameworks or dependencies.
4. **Check proportionately.** Run typecheck/lint/tests/build once when finishing a meaningful change, not after every edit. Skip repetitive audits; a browser walkthrough in mock mode is enough for UI work.
5. **Protect secrets and private data.** Never print or commit `.env`, keys, signed URLs, session tokens, blueprints, or user notes/transcripts. Don't redistribute the original uploaded ZIP (it contained `.env`).
6. **Keep mock and real honest.** Mock stays opt-in, labeled `DEV MOCK`, and impossible in production. Never present mock grades, scripted replies or missing transcripts as real.
7. **Ask before spending or shipping.** No paid provider calls, commits, pushes, deploys or billing changes without explicit permission.
8. **Respect teammates' work.** Check `git status` before editing and keep uncommitted changes intact.
9. **Report briefly:** what works now, what was verified (and whether real providers were called), what doesn't work, files changed.
