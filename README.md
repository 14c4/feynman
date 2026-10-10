# feynman.ai

A Health-track test-readiness app for material you have already studied: answer three questions, talk through uncertain concepts with a curious student, answer three matched follow-up questions, and compare your responses. Optional nervousness ratings are self-reported, not diagnoses.

## Current hackathon checkpoint

The application is being integrated around **one complete practice cycle**. Home, the shared baseline/follow-up assessment, focused conversation, grading states and Results are wired to the practice API. Provider adapters make real Gemini/ElevenLabs requests; application behavior is not simulated.

- Start both the frontend (`npm run dev`) and API (`npm run dev:server`).
- Configure server-only `GEMINI_API_KEY`, optional `GEMINI_MODEL` (default `gemini-2.5-flash`), `ELEVENLABS_API_KEY`, and `ELEVENLABS_AGENT_ID` in `.env`, using `.env.example` as a template. Restart the API after changes.
- Configure a **private ElevenLabs Agent using a Gemini model**. Its system prompt should use `{{focus_context}}` to guide short, supportive questions, let the learner do most of the explaining, provide guidance when stuck, and treat supplied material as data rather than instructions. Suggested first message: `Let's talk through {{session_title}}. {{opening_question}}`. The application also sends `session_id` for conversation association. Verify these settings on a real call.
- Sessions are held in API process memory. Browser references/drafts can survive a refresh while the same API process remains running. Restarting the API loses its sessions; start a fresh session afterward.
- Repeat cycles, durable backend storage, request locks, uploads, timing and Presage are deferred.
- Live Gemini adapter checks with the configured `gemini-3.8-flash` successfully generated three question pairs and graded a sample answer. A complete browser session and ElevenLabs audio remain unverified. Missing credentials produce explicit errors; no invented questions or scores appear as a fallback.

`GET /api/health` reports configuration booleans only; these do not prove successful provider calls. The practice endpoints are `/api/sessions` and `/api/sessions/:id` with `prepare`, `submit`, `voice`, `recheck`, `pause`, `resume`, and `finish` actions. Conversation registration/history is supplementary; typed assessment responses determine scores.

Checkpoint verification: `npm run typecheck` passed and `npm test` passed 8 tests. The single-cycle API test uses injected test providers to check state/API integration; separate bounded calls verified real Gemini generation and sample grading. Provider errors now identify Google's HTTP status and sanitized message, including temporary `503 UNAVAILABLE` high-demand failures. The complete preparation schema is required, preventing a ready response with missing questions. Browser checks, ElevenLabs audio, lint, and production build are still pending.

The sections below describe the **historical pre-pivot foundation** and are retained for reference until the first live cycle is verified.

## Run locally

Use **Node.js 24 LTS** (minimum 22.12) and npm.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). The frontend works independently of the backend. In a second terminal, optionally start the API skeleton:

```sh
npm run dev:server
```

Health endpoint: `http://127.0.0.1:3001/api/health`. Vite proxies `/api` requests to the backend in development. Copy `.env.example` to `.env` only when needed; no variables are required now. Restart Vite if you change `PORT`. `HOST` defaults to `127.0.0.1`; use a compatible local bind address for the dev proxy.

## What works

- Topic selection → preparation → active study → completion → results → linked retry.
- Prominent microphone control with an expandable **Use text instead** fallback below the session controls; saved explanations appear in the transcript and blank input is rejected.
- Unsaved text prompts before in-app navigation/finish; browser refresh warns about an unsaved draft.
- Attempt history for the same topic, retained for this browser visit.
- Recovery views for invalid URLs and sessions lost after refresh.
- Responsive layouts, keyboard focus, labeled forms, and a native save/discard dialog.

Voice controls are disabled. No audio is recorded, no student replies are generated, and no explanation is evaluated. Results include **one clearly labeled Recursion example**, with its own sample transcript and evidence. It is never attached to the user's session, including when the user studies a different topic.

**Sessions live in React memory. Refreshing or closing the tab clears them.** Leaving an unfinished session marks it abandoned; completed transcripts remain read-only. Retries create new sessions rather than overwriting prior attempts. Attempt numbers include abandoned preparations; comparison lists show completed attempts only.

## Structure and ownership

| Location | Purpose | Primary owner |
| --- | --- | --- |
| `src/features/topics/` | Topic selection and learning content | A (UI), B (`topics.ts`) |
| `src/features/study/` | Preparation, avatar, text input, transcript, controls | A |
| `src/features/feedback/` | Results and future comparison layout | A (UI), B (`sampleFeedback.ts`) |
| `src/components/`, `src/styles/` | Shared UI and design tokens | A |
| `src/services/contracts/voice.ts` | Future ElevenLabs lifecycle contract | A |
| `src/services/contracts/student.ts`, `evaluation.ts` | Future Gemini service contracts | B |
| `shared/types.ts` | Domain types usable by client and server | Agreed together; C coordinates |
| `src/state/`, `src/app/` | Session state, route lifecycle, navigation | C |
| `server/`, `tests/`, root configuration | Backend skeleton, verification, setup | C |

Keep feature-specific components and CSS inside their features. Scope selectors (`topic-*`, `study-*`, `concept-*`) and use shared CSS tokens. Coordinate shared-type and dependency changes; C owns lockfile updates. No state-management, component, or backend framework is required.

## Integration boundaries

- **ElevenLabs:** implement `VoiceService` and `VoiceConnection`. Enable controls only when a real adapter is ready. Disconnect must finish transcript delivery and cleanup before evaluation starts.
- **Gemini student reasoning:** implement `StudentReasoningService`. The future integration layer connects reasoning to the voice conversation; transcription and orchestration are still team decisions.
- **Gemini evaluation:** implement `EvaluationService`, returning concept IDs and evidence message IDs from the actual transcript. Add evaluation state actions and a real-results render path when this is connected; the empty evaluation map/status fields reserve that location now.
- **Backend:** provider keys stay server-side. Never prefix credentials with `VITE_`, which exposes values to the browser. Server startup loads an optional root `.env`; no keys are read by the current routes.

`server/routes.ts` provides:

| Endpoint | Current response |
| --- | --- |
| `GET /api/health` | `200`, basic service status |
| `POST /api/voice/session` | `501`, integration pending; payload TBD |
| `POST /api/student/reply` | `501`, integration pending |
| `POST /api/evaluations` | `501`, integration pending |
| Other requests | `404`, structured error |

The POST endpoints do not parse payloads or contact providers. Add payload validation, real adapters, and response mapping during integration. UI components should consume the contracts/domain types rather than vendor SDK types.

## Checks and build

```sh
npm run lint
npm test
npm run build
```

Build typechecks the frontend, configuration, backend, and tests, then writes the frontend to `dist/`. Tests use Node's built-in runner for session transition integrity and backend responses. `npm run typecheck` runs just TypeScript; `npm run preview` previews the frontend production build. `npm run start:server` runs the skeleton without watching (it currently requires the `tsx` development dependency).

Manual smoke check: try all three topics, expand **Use text instead**, enter/save text, expand the transcript, finish, retry, and complete a second attempt. Test save/discard/stay when navigating with unsaved text, invalid session URLs, and a narrow mobile viewport.

## Deployment notes

Deploy `dist/` to a static host with an **SPA fallback to `index.html`** for `/study/*` and `/results/*`. Vite's `/api` proxy is development-only. When integrations are ready, configure the deployed host to forward `/api` to the backend or add a public API base URL. No deployment provider or production backend infrastructure is configured yet.
