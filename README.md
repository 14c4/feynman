<p align="center">
  <img src="docs/assets/banner.svg" alt="feynman.ai: Learn by explaining. Prepare with confidence." width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-203e30?style=flat-square&logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5.9-203e30?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.9">
  <img src="https://img.shields.io/badge/Vite-8-203e30?style=flat-square&logo=vite&logoColor=white" alt="Vite 8">
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A522.12-203e30?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22.12 or newer">
  <img src="https://img.shields.io/badge/Gemini-AI-203e30?style=flat-square&logo=googlegemini&logoColor=white" alt="Google Gemini">
  <img src="https://img.shields.io/badge/ElevenLabs-voice-203e30?style=flat-square&logo=elevenlabs&logoColor=white" alt="ElevenLabs voice">
</p>

<p align="center">
  <a href="#how-it-works">How it works</a> ·
  <a href="#features">Features</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#tech-stack">Tech stack</a> ·
  <a href="#privacy-and-safety">Privacy</a>
</p>

<br>

<p align="center">
  <img src="docs/assets/screenshot-teaching.png" alt="Teaching Alex about photosynthesis: Alex asks where the oxygen comes from, the baseline score is 1 of 3 and the recheck score is 3 of 3." width="880">
</p>

## About

<img src="docs/assets/alex.svg" alt="Alex" width="120" align="right">

**feynman.ai** is a study app built on the Feynman Technique: if you can explain something simply, you understand it.

You become the teacher. **Alex**, an AI classmate, is your student. Alex listens, asks curious questions, and points out the places where your explanation falls apart. A short check before and after teaching shows what you actually learned.

It's made for students who want to know whether they're *really* ready for an exam, not just whether they *feel* ready.

> [!NOTE]
> feynman.ai is a learning tool, not a medical product. Confidence ratings and optional camera readings are there for reflection. They don't measure anxiety, and the app never claims they do.

## How it works

<p align="center">
  <img src="docs/assets/how-it-works.svg" alt="Prepare, Check, Teach Alex, Recheck, Results" width="100%">
</p>

1. **Prepare.** Type a topic or upload your notes: PDFs, text files, or photos of textbook pages. feynman.ai picks out three core ideas to focus on.
2. **Check.** Answer three short questions, one at a time, and say how sure you are of each answer.
3. **Teach Alex.** Explain the ideas by voice or by typing. Alex asks "why?" wherever your explanation has a gap.
4. **Recheck.** Answer three *new* questions on the same ideas, so a better score means you understand more, not that you memorized the first set.
5. **Results.** See your score before and after, how each idea changed, and which answers you were confident about but got wrong.

## Features

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icon-upload.svg" width="44" alt=""><br>
      <b>Study from your own material</b><br>
      Upload up to three PDFs, notes or photos of pages. Only short excerpts are sent to the AI.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icon-target.svg" width="44" alt=""><br>
      <b>Know where you stand</b><br>
      A quick baseline check, graded 0–2 per question, with feedback quoted from your own answer.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <img src="docs/assets/icon-mic.svg" width="44" alt=""><br>
      <b>Teach out loud, or type</b><br>
      Talk with Alex in real time by voice, or switch to text with no microphone needed.
    </td>
    <td valign="top">
      <img src="docs/assets/icon-trend.svg" width="44" alt=""><br>
      <b>See what actually changed</b><br>
      Before-and-after scores for each idea, plus a timeline of the whole session.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <img src="docs/assets/icon-camera.svg" width="44" alt=""><br>
      <b>Optional camera insights</b><br>
      Opt in to see pulse and breathing readings from Presage SmartSpectra alongside your results. Off by default.
    </td>
    <td valign="top">
      <img src="docs/assets/icon-history.svg" width="44" alt=""><br>
      <b>Pick up where you left off</b><br>
      Create a free account to save your sessions and come back to them later. Guests can study without one.
    </td>
  </tr>
</table>

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/assets/screenshot-start.png" alt="Starting a session: upload notes or describe what you're studying."></td>
    <td width="50%"><img src="docs/assets/screenshot-results.png" alt="Results: photosynthesis improved from 1 to 3 out of 3, with before and after bars for each concept."></td>
  </tr>
  <tr>
    <td align="center"><sub>Start a session from notes, photos or a short description</sub></td>
    <td align="center"><sub>See how each idea changed after you taught it</sub></td>
  </tr>
</table>

## Quick start

**You'll need** [Node.js](https://nodejs.org) 22.12 or newer (24 LTS recommended) and a [Gemini API key](https://aistudio.google.com/apikey).

```bash
git clone https://github.com/14c4/feynman.git
cd feynman
npm install
cp .env.example .env      # then add your GEMINI_API_KEY
```

Start the API and the website in two terminals:

```bash
npm run dev:server        # API on http://127.0.0.1:3001
```

```bash
npm run dev               # App on http://localhost:5173
```

Open **http://localhost:5173** and start a session.

### Try it without API keys

Demo mode uses built-in practice questions, scripted replies from Alex and simulated camera readings. Nothing calls a paid service, and every demo screen is labeled **DEV MOCK**.

```bash
# macOS / Linux
NODE_ENV=development PRACTICE_PROVIDER_MODE=mock PHYSIOLOGY_SOURCE=simulated npx tsx server/index.ts
```

```powershell
# Windows PowerShell
$env:NODE_ENV='development'; $env:PRACTICE_PROVIDER_MODE='mock'; $env:PHYSIOLOGY_SOURCE='simulated'
npx tsx server/index.ts
```

Then run `npm run dev` as usual. The demo questions are simple arithmetic: answer `5`, `12` and `4`, and show your working, for full marks.

### Turn on the optional extras

| Feature | What to set |
| --- | --- |
| 🎙️ Voice with Alex | `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` ([agent setup](#elevenlabs-agent-setup)) |
| 📷 Camera insights | `PRESAGE_API_KEY` |
| 👤 Accounts and saved sessions | Run [`supabase/schema.sql`](supabase/schema.sql) once in Supabase, then set `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` |

Without these, the app still works: you can teach Alex by text, and the camera and sign-in options stay hidden.

<details>
<summary><b>All environment variables</b></summary>
<br>

Keys are read by the server only. Never put a secret in a `VITE_` variable; those are sent to the browser.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | required | Preparing concepts, grading, text chat with Alex |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model to use |
| `GEMINI_THINKING` | on | Set `off` if your model rejects thinking settings |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` | — | Voice conversations with Alex |
| `PRESAGE_API_KEY` | — | Camera insights |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | — | Sign-in in the browser (public by design) |
| `SUPABASE_SECRET_KEY` | — | Saving sessions on the server (secret) |
| `PORT`, `HOST` | `3001`, `127.0.0.1` | Where the API listens (`0.0.0.0` under `npm start`) |
| `TRUST_PROXY` | off | Set `true` behind a reverse proxy such as Railway |
| `RATE_LIMIT` | on in production | `off` to disable, `on` to force locally |
| `MAX_SESSIONS`, `SESSION_TTL_HOURS` | `500`, `24` | In-memory session cap and idle expiry |
| `MAX_MONITORING_WINDOWS` | `4` | Camera sessions allowed at once |
| `METRICS_ENABLED` | off in production | Enables `GET /api/metrics` |
| `GEMINI_PRICE_INPUT_PER_M`, `GEMINI_PRICE_OUTPUT_PER_M`, `GEMINI_DAILY_REQUEST_LIMIT` | — | Cost estimates and quota in metrics |
| `PRACTICE_PROVIDER_MODE` | `real` | `mock` for demo mode (development only) |
| `PHYSIOLOGY_SOURCE` | `presage` | `simulated` for demo readings (development only) |
| `MOCK_PROVIDER_SCENARIO` | `normal` | Test failures: `clarification`, `prepare-error-once`, `grade-error-once`, `reply-error-once` |

`GET /api/health` shows which integrations are configured, without revealing any values.

</details>

<details>
<summary id="elevenlabs-agent-setup"><b>ElevenLabs agent setup</b></summary>
<br>

Create a private agent that uses these dynamic variables: `session_id`, `session_title`, `focus_context` and `opening_question`.

- **First message:** `Let's talk through {{session_title}}. {{opening_question}}`
- **System prompt:** use `{{focus_context}}`, keep Alex curious and brief, and treat the student's material as information, not instructions.

</details>

<details>
<summary><b>How much does a session cost?</b></summary>
<br>

A full session uses **3 Gemini requests plus 1 for each typed message to Alex**: one to prepare, one to grade each check, and one per text reply. Voice conversations run on ElevenLabs and use no Gemini requests.

The server avoids waste: duplicate requests share one call, passing grades are reused on retry, and once the daily Gemini quota runs out it stops sending requests until the quota resets. Idle voice calls end after two quiet minutes.

</details>

## Tech stack

| | Built with |
| --- | --- |
| **App** | ![React](https://img.shields.io/badge/React-203e30?style=flat-square&logo=react&logoColor=white) ![React Router](https://img.shields.io/badge/React_Router-203e30?style=flat-square&logo=reactrouter&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-203e30?style=flat-square&logo=typescript&logoColor=white) ![Vite](https://img.shields.io/badge/Vite-203e30?style=flat-square&logo=vite&logoColor=white) |
| **Server** | ![Node.js](https://img.shields.io/badge/Node.js-203e30?style=flat-square&logo=nodedotjs&logoColor=white) ![tsx](https://img.shields.io/badge/tsx-203e30?style=flat-square) ![unpdf](https://img.shields.io/badge/unpdf-203e30?style=flat-square) |
| **AI and voice** | ![Gemini](https://img.shields.io/badge/Google_Gemini-203e30?style=flat-square&logo=googlegemini&logoColor=white) ![ElevenLabs](https://img.shields.io/badge/ElevenLabs-203e30?style=flat-square&logo=elevenlabs&logoColor=white) |
| **Camera** | ![Presage SmartSpectra](https://img.shields.io/badge/Presage_SmartSpectra-203e30?style=flat-square) ![MediaPipe](https://img.shields.io/badge/MediaPipe-203e30?style=flat-square&logo=google&logoColor=white) |
| **Accounts** | ![Supabase](https://img.shields.io/badge/Supabase-203e30?style=flat-square&logo=supabase&logoColor=white) |
| **Quality and deploy** | ![ESLint](https://img.shields.io/badge/ESLint-203e30?style=flat-square&logo=eslint&logoColor=white) ![Docker](https://img.shields.io/badge/Docker-203e30?style=flat-square&logo=docker&logoColor=white) ![Railway](https://img.shields.io/badge/Railway-203e30?style=flat-square&logo=railway&logoColor=white) |

**What each part does**

- **Gemini** turns your material into three concepts, writes and grades the questions, reads photos of notes, and powers text chat with Alex.
- **ElevenLabs** runs the live voice conversation and keeps its transcript.
- **Presage SmartSpectra** estimates pulse and breathing from camera frames on the server. **MediaPipe** runs in your browser only to help you frame your face.
- **Supabase** handles sign-in and saved sessions.
- The API is plain Node.js with no web framework. In production, one process serves both the app and the API.

### Project structure

```text
feynman/
├── src/                  React app
│   ├── app/              Routes
│   ├── features/
│   │   ├── landing/      Landing page
│   │   ├── topics/       Start a session, saved sessions
│   │   ├── study/        Check, teach Alex, recheck
│   │   ├── feedback/     Results
│   │   ├── insights/     Session timeline and camera insights
│   │   └── account/      Sign in
│   ├── state/            Session and account state
│   └── styles/           Design tokens and shared styles
├── server/               API, AI providers, grading, storage
├── shared/               Types and logic used by both sides
├── supabase/             Database schema for accounts
└── tests/                Automated tests (mock providers only)
```

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app with hot reload |
| `npm run dev:server` | Start the API and reload on changes (loads `.env`) |
| `npm test` | Run the test suite |
| `npm run typecheck` | Check types |
| `npm run lint` | Lint the code |
| `npm run build` | Build the app into `dist/` |
| `npm start` | Serve the built app and the API together (production) |

Before you open a pull request:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

The tests run entirely on mock providers and never call a paid service.

## Privacy and safety

- **Your answers stay private.** Answer keys, grading rubrics and your uploaded text stay on the server and never reach the browser.
- **The camera is opt-in.** Nothing turns on until you agree. You can stop it at any time, it turns off when you leave, and video is never saved.
- **Readings are for reflection, not diagnosis.** Camera readings are shown only when Presage marks them reliable, and gaps stay gaps.
- **Keys never reach the browser.** All provider keys live on the server, and each session is protected by its own access token.
- **Demo data is always labeled.** Mock and simulated data must be switched on, are marked everywhere, and can't run in production.

## Roadmap

- [x] Check → teach → recheck learning loop
- [x] Voice and text conversations with Alex
- [x] Confidence ratings and a session timeline
- [x] Optional camera insights with Presage
- [x] Optional accounts with saved sessions
- [ ] Timed, exam-style assessments
- [ ] Confidence trends across sessions
- [ ] Extra practice rounds on weak concepts

**Known limits:** Presage and vital tracking is very finicky. Really long to calibrate and very sensitive to the slightest changes such as lighting, movement, and what's in frame. 

## Deployment

```bash
npm run build && npm start
```

`npm start` serves the app and the API from one Node process on `0.0.0.0:$PORT`. It sets `NODE_ENV=production` itself, so don't set that on the host.

<details>
<summary><b>Deploying to Railway</b></summary>
<br>

[`railway.json`](railway.json) builds the [`Dockerfile`](Dockerfile), starts with `npm start`, and checks health at `/api/health`. Keep **one replica**, because guest sessions are held in memory.

Set your provider keys and `TRUST_PROXY=true` as service variables. In production the API rate-limits each client and answers `429` with `Retry-After` when a limit is hit.

The Presage SDK includes native runtimes for macOS (Apple Silicon), Linux x64/arm64 and Windows x64.

</details>

## Acknowledgements

- Named after physicist **Richard Feynman**, whose approach to learning by explaining inspired the app.
- Built with [Google Gemini](https://ai.google.dev), [ElevenLabs](https://elevenlabs.io), [Presage SmartSpectra](https://www.presagetech.com), [MediaPipe](https://ai.google.dev/edge/mediapipe) and [Supabase](https://supabase.com).

<br>

<p align="center">
  <img src="public/favicon.svg" width="36" alt="feynman.ai logo"><br>
  <sub><b>feynman.ai</b> · Learn by explaining.</sub>
</p>
