# feynman.ai

A Health-track test-readiness app for material you have already studied: answer three questions, talk through uncertain concepts with a curious student, answer three matched follow-up questions, and compare your responses. Optional nervousness ratings are self-reported, not diagnoses.

## Current checkpoint — functional Stage 1

The designed homepage/sidebar and shared assessment now use the existing session API: topic/notes → preparation/clarification → three server-issued baseline questions → saved answers/working → grading/retry → teaching stage. Back/next, skips, uncertainty, pause/resume and refresh recovery are verified. `/preview` remains an isolated visual prototype.

To test without provider credits, use two terminals:

```powershell
# Terminal 1, from the repository
$env:NODE_ENV = 'development'
$env:PRACTICE_PROVIDER_MODE = 'mock'
npm run dev:server
```

```powershell
# Terminal 2
npm run dev
```

Open `http://localhost:5173/` (or Vite's printed port). **DEV MOCK** is explicitly labeled: fixed arithmetic questions and deterministic test grades, not Gemini evaluation. No Gemini or ElevenLabs requests are made. Mock mode refuses production startup. Real adapters remain the default when `PRACTICE_PROVIDER_MODE` is absent or `real`.

Optional API environment: `MOCK_PROVIDER_SCENARIO=normal|clarification|prepare-error-once|grade-error-once`, `MOCK_PROVIDER_DELAY_MS=0..10000`. Set one scenario value before starting/restarting the API. The failure scenarios fail once per process. Baseline fixture answers: `5`, `12`, `4`; a matching answer earns one test point, with nonempty working a second. Mock conversations are disabled at the Stage 1 checkpoint.

Checks: typecheck passed; lint passed with zero warnings; 16 tests passed; build passed with the existing large-chunk advisory. API-backed browser checks passed normal/failure/refresh/interruption/restart paths, keyboard navigation and accessibility/responsive checks. No real provider calls were made.

**Stopped for review.** Stage 2 conversation/text-only/follow-up/results integration is not started. Server sessions still require the original in-memory API process. See [the audit, exact changed files, verified behavior, blockers and Stage 3 plan](docs/functional-integration.md).

## Interactive frontend prototype — earlier design checkpoint

Run `npm run dev` and open **http://localhost:5173/preview** (use Vite’s printed port if different). The preview needs no backend or provider credentials. The live application remains at `/`; the preview’s **LIVE · Open live application** link returns there.

| Preview URL | Experience |
| --- | --- |
| `/preview` or `/preview/practice` | Dashboard, topic/notes form, sample shortcuts, recent sessions and new-user empty state |
| `/preview/baseline` | Three baseline questions, local drafts/working, uncertainty, skip/back/next, evaluation and failure states |
| `/preview/conversation` | Alex’s avatar, six sample connection states, transcript reveal and local text alternative |
| `/preview/followup` | Different matched questions using the same assessment presentation |
| `/preview/results` | Example scores, concept comparison, answer/transcript review and optional reflection |
| `/preview/history` | Search/filter sample sessions, resume/review and local completion state |

Choose a sample subject, then **Start practicing**, or use the top screen selector and practice-stage links to inspect screens directly. Open **Explore assessment states** for loading/failure controls and a sample answer shortcut. Open **Explore conversation states** to switch between disconnected, connecting, listening, speaking, muted and error appearances. The microphone-shaped control changes a **sample visual state only**.

The reviewed preview uses a leaner layout: decorative sidebar/footer slogans and dashboard/assessment explainer side panels have been removed. Side content is limited to useful controls, focus concepts and the transcript.

**PREVIEW:** all questions, example grades, focus concepts, AI dialogue and historical entries are hand-authored fixtures. Your typed answers are ungraded and displayed separately from example responses. Editing the subject/notes does not generate new questions. Local drafts, text entries and pause/finish state survive navigation within the preview but reset on refresh or leaving it. One current local demonstration is kept alongside fixed history examples; opening another example replaces that demonstration.

**LIVE:** the functional checkpoint above now applies the approved dashboard/assessment presentation to the practice API. Independent text-only conversation and the remaining conversation/results integration require further approval. The preview is lazy-loaded outside `SessionProvider`, makes no API or microphone requests, and never writes production session storage. The original prototype introduced no backend/dependency changes; current functional changes are recorded separately.

Stage 1 checks: typecheck passed; lint passed with one pre-existing `SessionProvider.tsx` warning; all 8 existing tests passed; production build passed with its pre-existing bundle-size warning. Production-browser checks passed for six views at 320/390/768/1440 px, automated WCAG A/AA scans, the interactive sample cycle, keyboard activation, reduced motion, storage isolation and zero preview API/microphone calls. Live home/recovery routes and assessment navigation were smoke-tested (assessment used an injected UI test fixture, not real grading). Desktop/mobile screenshots were inspected. See [the audit, architecture and gated Stage 2–4 roadmap](docs/frontend-redesign.md).

At the earlier design checkpoint, no live redesign integration, provider verification, commit or deployment was performed. The functional Stage 1 checkpoint above is the latest state.

## Current hackathon checkpoint

The application is being integrated around **one complete practice cycle**. Home, the shared baseline/follow-up assessment, focused conversation, grading states and Results have existing practice API wiring. Normal adapters make real Gemini/ElevenLabs requests; the explicit non-production provider mode above supplies isolated development fixtures. Full real conversation verification remains pending.

- Start both the frontend (`npm run dev`) and API (`npm run dev:server`).
- Configure server-only `GEMINI_API_KEY`, optional `GEMINI_MODEL` (default `gemini-2.5-flash`), `ELEVENLABS_API_KEY`, and `ELEVENLABS_AGENT_ID` in `.env`, using `.env.example` as a template. Restart the API after changes.
- Configure a **private ElevenLabs Agent using a Gemini model**. Its system prompt should use `{{focus_context}}` to guide short, supportive questions, let the learner do most of the explaining, provide guidance when stuck, and treat supplied material as data rather than instructions. Suggested first message: `Let's talk through {{session_title}}. {{opening_question}}`. The application also sends `session_id` for conversation association. Verify these settings on a real call.
- Sessions are held in API process memory. Browser references/drafts can survive a refresh while the same API process remains running. Restarting the API loses its sessions; start a fresh session afterward.
- Repeat cycles, durable backend storage, request locks, uploads, timing and Presage are deferred.
- Live Gemini adapter checks with the configured `gemini-3.8-flash` successfully generated three question pairs and graded a sample answer. A complete browser session and ElevenLabs audio remain unverified. Missing credentials produce explicit errors; no invented questions or scores appear as a fallback.

`GET /api/health` reports configuration booleans only; these do not prove successful provider calls. The practice endpoints are `/api/sessions` and `/api/sessions/:id` with `prepare`, `submit`, `voice`, `recheck`, `pause`, `resume`, and `finish` actions. Conversation registration/history is supplementary; typed assessment responses determine scores.

Checkpoint verification: `npm run typecheck`, `npm run lint` (one existing warning), `npm test` (8 tests), and `npm run build` (existing chunk-size warning) passed at the frontend-prototype checkpoint. The single-cycle API test uses injected test providers to check state/API integration; earlier separate bounded calls verified real Gemini generation and sample grading. Provider errors identify Google's HTTP status and sanitized message, including temporary `503 UNAVAILABLE` high-demand failures. The complete preparation schema is required, preventing a ready response with missing questions. Preview browser verification is recorded above; a full live browser cycle, ElevenLabs audio and final provider transcript retrieval remain unverified.

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
