<div align="center">

# feynman.ai

**Learn by explaining. Prepare with confidence.**

An exam-readiness app built on the Feynman Technique: check what you know, teach it to an AI classmate, then prove what changed, with an honest view of how sure you felt along the way.

</div>

---

## Why

Students preparing for exams often can't tell the difference between *feeling* ready and *being* ready, and that uncertainty feeds test anxiety. feynman.ai makes readiness visible with three signals, all tied to one session timeline:

| Signal | What it shows | How it's captured |
| --- | --- | --- |
| **Knowledge** | What you can actually explain and answer | Graded short-answer checks before and after teaching |
| **Confidence** | How sure you felt, and whether that matched your results | Optional rating on every answer |
| **Physiology** *(optional)* | Pulse and breathing during learning and assessment | Consent-based webcam measurement via Presage SmartSpectra |

> feynman.ai is an educational tool. It is **not** a medical or diagnostic product. Physiological readings are shown for reflection only. They don't measure anxiety or confidence, and the app never claims they do.

## How a session works

```
 Topic + notes/files ─▶ 3 concepts ─▶ First check ─▶ Teach Alex ─▶ Follow-up check ─▶ Readiness Insights
                                     (3 questions)   (voice/text)   (3 matched questions)
```

1. **Prepare.** Enter a topic, optional notes, and up to three PDF/TXT/Markdown files. Gemini distills them into three core concepts, or asks one clarifying question first.
2. **First check.** One question at a time, with optional working and a quick *Guessing / Somewhat sure / Confident* rating. No hints until the end.
3. **Teach Alex.** You're the teacher. Alex, an AI classmate, listens and asks curious questions where your explanation has gaps. Talk by voice (ElevenLabs) or type.
4. **Follow-up check.** New questions on the same concepts, so improvement isn't memorization.
5. **Readiness Insights.** An interactive timeline of the whole session: what you thought you knew, what you showed, how Alex challenged you, and what changed.

## Features

### Readiness Insights timeline
- One chronological view of the session, with **Getting ready, First check, Teaching Alex, Follow-up and Reflection** phases.
- Each answer is plotted with **height for stated confidence and colour for the grade**, including partial credit.
- **Confident-but-incorrect** and **correct-but-unsure** answers are highlighted and listed under *Worth a look*.
- **Concept journeys** trace each concept from first check, through the conversation with Alex, to the matched follow-up.
- Click any moment to see the question, your answer, the feedback, the matched counterpart and nearby readings.
- Pulse and breathing lanes plot only readings Presage reports as reliable; gaps are left as gaps.
- Phones get a list view grouped by phase, and a quick *at a glance* summary sits above the timeline.

### Learning loop
- Server-side text extraction from uploads. Only bounded excerpts reach the AI providers.
- Expected answers, rubrics and reserved follow-up questions stay in a private server blueprint and never reach the browser.
- Answers autosave (browser draft, then server), survive refresh, and support pause/resume.
- Grading uses a 0–2 rubric per question with evidence quoted from your own answer. Invented evidence is rejected.

### Teaching Alex
- **Voice:** an ElevenLabs agent with a server-issued signed URL. The microphone is requested before any credentials are fetched. Transcripts are retrieved from ElevenLabs history and labeled *pending*, *ready* or *incomplete*.
- **Text:** a server-backed conversation with Gemini, with a turn limit and retry.
- Alex's avatar reflects real state: listening, thinking, speaking, interrupted and so on.

### Camera insights (optional)
- Off until the student opts in. A consent card explains exactly what happens; no video is stored.
- Offers 60-second check-ins before the first check, after teaching and after the follow-up, or monitoring for the whole session.
- **Adaptive camera setup:** the app measures each camera's *real* frame rate from capture timestamps and picks a configuration that works. It steps down resolution if the rate drops, and gives plain advice about lighting or system load.
- Every real frame is sent once, in capture order, with its original timestamp. No frames are duplicated and no data is fabricated.
- If a camera can't meet Presage's requirements, monitoring stops with a clear explanation and the study session carries on.

## Architecture

```
Browser (React + Vite)                         Node API (http, no framework)
┌──────────────────────────────┐   /api/*    ┌──────────────────────────────────────┐
│ Home · Study · Results       │ ──────────▶ │ routes.ts   sessions, events, actions │
│ SessionProvider (drafts,     │             │ domain.ts   validation, grading       │
│   autosave, refresh recovery)│             │ providers.ts Gemini + ElevenLabs      │
│ MonitoringProvider (camera)  │ ─ frames ─▶ │ physiology.ts Presage Node SDK        │
│ Readiness Insights timeline  │             │ store.ts    in-memory session store   │
└──────────────────────────────┘             └──────────────────────────────────────┘
          ▲  ElevenLabs voice (signed URL, WebSocket)        │ Gemini · ElevenLabs · Presage
```

**Why camera frames go through the server:** Presage SmartSpectra has no browser SDK. Its JavaScript runtime is the Node SDK (`@smartspectra/node-sdk`). The browser downsizes each camera frame (long side ≤ 480 px) and posts small ordered batches to the API. The API feeds them to the SDK with `useCustomInput()` and `sendFrame()`. Frames are processed in memory and discarded.

**Event timeline:** the server appends a timestamped, sequence-numbered event for each real moment, such as an assessment starting, an answer being recorded, grading, teaching starting and nervousness self-reports. Conversation turns and physiology samples keep their own timestamps. `shared/insights.ts` merges these into a single ordered timeline. Nothing is back-filled after the fact.

| Area | Location |
| --- | --- |
| Routes and pages | `src/app/App.tsx` (`/`, `/study/:id`, `/results/:id`, `/preview`) |
| Study flow | `src/features/study/` |
| Readiness Insights and camera | `src/features/insights/` |
| Results | `src/features/feedback/ResultsPage.tsx` |
| Client state and API | `src/state/`, `src/services/practiceApi.ts` |
| Shared contract and insight logic | `shared/types.ts`, `shared/insights.ts` |
| Server | `server/` |
| Design tokens and primitives | `src/styles/tokens.css`, `src/styles/global.css` |
| Tests | `tests/` (Node test runner) |

## Getting started

**Requirements:** Node.js ≥ 22.12 (24 LTS recommended) and npm.

```bash
npm install
cp .env.example .env    # then fill in the keys you have
```

Run the API and the frontend in two terminals:

```bash
npm run dev:server      # API on http://127.0.0.1:3001 (loads .env)
```

```bash
npm run dev             # Vite on http://localhost:5173, proxies /api to the API
```

### Configuration

All keys are server-side only. Never prefix them with `VITE_`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Concept preparation, grading and text conversation |
| `GEMINI_MODEL` | No | Defaults to `gemini-2.5-flash` |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` | For voice | Voice conversation with Alex; text works without them |
| `PRESAGE_API_KEY` | For camera insights | Presage SmartSpectra key; camera insights are disabled without it |
| `PHYSIOLOGY_SOURCE` | No | `presage` (default) or `simulated` (development only) |
| `PRACTICE_PROVIDER_MODE` | No | `real` (default) or `mock` (development only) |
| `PORT`, `HOST` | No | API bind address (default `127.0.0.1:3001`) |

**ElevenLabs agent setup:** use a private agent with these dynamic variables: `session_id`, `session_title`, `focus_context` and `opening_question`. A good first message is `Let's talk through {{session_title}}. {{opening_question}}`. The system prompt should use `{{focus_context}}`, keep Alex curious and brief, and treat supplied material as data rather than instructions.

`GET /api/health` reports which integrations are configured without exposing any values.

### Demo mode (no API keys or provider credits)

Mock mode uses deterministic arithmetic fixtures, scripted Alex replies and synthetic, labeled physiology. Every mock surface is marked **DEV MOCK** or **DEV SIMULATED**, and production startup refuses mock mode.

```powershell
$env:NODE_ENV = 'development'; $env:PRACTICE_PROVIDER_MODE = 'mock'; $env:PHYSIOLOGY_SOURCE = 'simulated'
npx tsx server/index.ts   # does not load .env, so no real keys are used
```

Fixture answers for the first check are `5`, `12` and `4`, with working for full marks. `MOCK_PROVIDER_SCENARIO` can simulate failures: `clarification`, `prepare-error-once`, `grade-error-once` or `reply-error-once`.

`/preview` is a separate design preview with sample data. It makes no API calls.

## Quality

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

The test suite runs entirely against mocks and never contacts real providers. It covers:
- the full study cycle;
- uploads and privacy of the answer blueprint;
- grading validation and recovery from failures;
- confidence persistence and event ordering;
- calibration and timeline construction;
- Presage reliability rules and ingestion order;
- camera frame-rate negotiation and recovery at 15, 20, 25 and 30 fps.

## Privacy and safety

- Optional reflections and camera insights are framed as reflection, never as diagnosis. No health benefits are claimed.
- The camera needs explicit opt-in, can be stopped at any time, and turns off when you leave the session. Raw video is never stored.
- Uploaded text, answer keys and API keys stay on the server. Sessions are accessed with per-session bearer tokens.
- Mock and simulated data are opt-in, labeled everywhere, and impossible in production.

## Current limitations and roadmap

**Current limitations:**
- Sessions live in API process memory; restarting the API clears them. There is no authentication, durable storage or rate limiting yet, so it is not ready for public deployment.
- Each session runs one practice cycle; extra cycles on weak concepts are planned.
- On browsers without `MediaStreamTrackProcessor` (Firefox, Safari), camera capture pauses while the tab is in the background.

**Planned next:**
- Timed, exam-style assessments.
- Confidence trends across sessions.
- Durable storage, accounts and provider budget protection.

## Deployment notes

`npm run build` writes the frontend to `dist/`. Serve it with an SPA fallback to `index.html`, and route `/api` to the Node API (`npm run start:server`). The Vite `/api` proxy is for development only. The Presage Node SDK ships native runtimes for macOS (Apple Silicon), Linux x64/arm64 and Windows x64.
