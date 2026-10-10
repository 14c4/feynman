# Frontend redesign — Stage 1 review checkpoint

**Current status:** this document records the earlier visual prototype. The subsequent approved functional Stage 1 integrated its dashboard/assessment presentation with the session API and added isolated development providers. See [the functional audit and latest review checkpoint](functional-integration.md). Functional Stage 2 remains approval-gated.

**Scope:** Stage 0 repository audit and Stage 1 interactive visual prototype. Completed October 10, 2026. Stages 2–4 below are plans, not implemented features. No automatic integration, commit, push or deployment.

## Stage 0 — what the code actually does

The project uses React, TypeScript, Vite, React Router’s data router, plain scoped CSS, one React domain store and a small Node HTTP API. No new UI framework is needed.

| Area | Current implementation / limitation |
| --- | --- |
| Router | `src/app/App.tsx`: `/`, `/study/:sessionId`, `/results/:sessionId`; live routes stay under `SessionProvider` and `AppLayout`. |
| Home | `HomePage.tsx` accepts description/notes, calls `createSession`, triggers real question preparation and lists browser-known sessions. |
| Assessment | `StudyPage.tsx` uses the same `AssessmentPanel` for baseline/recheck; typed answers, optional working, skip/uncertainty, grading loading/errors and retry are implemented. |
| Conversation | `TeachingPanel` uses `@elevenlabs/react`, server-issued signed URLs, focus variables, real status/mode/mute events and transcript messages. Text send requires the voice connection; it is not an independent text-only service. |
| Results | `ResultsPage.tsx` reads actual attempt grades and concepts, answer review, transcripts, optional nervousness, and finish. Scores describe the questions, not mastery. |
| Browser state | `SessionProvider.tsx`/`sessionReducer.ts` keep one session map, access references, browser snapshots, debounced drafts and per-session client operation queues. |
| Backend | `server/routes.ts` has real create/prepare/submit/voice/recheck/pause/resume/finish/history operations; `MemorySessionStore` loses sessions after API restart. Additional cycles are explicitly deferred. |
| Privacy | `server/domain.ts` private blueprints retain expected answers/rubrics and reserved recheck questions. Gemini and ElevenLabs keys stay server-side. Public questions contain no private answers. |
| Transcript readiness | Disconnect starts history finalization, but provider processing may outlast the request; full real finalization/retrieval still needs verification. |
| Tests | Eight existing tests cover paired question validation, grading evidence/totals, sanitized provider errors, complete generation schema, one-cycle API transitions, and draft editing restrictions. API tests inject test providers. |

Older topic-centric components/contracts/fixtures remain in the repository. Some historical documentation refers to disabled voice or memory-only browser state; those sections do not describe the active practice implementation.

### Baseline checks before editing

- `npm run typecheck`: pass.
- `npm run lint`: zero errors, one existing warning at `SessionProvider.tsx:136` concerning `timers.current` in effect cleanup.
- `npm test`: all 8 pass.
- `npm run build`: pass; pre-existing live JavaScript chunk exceeds Vite’s 500 kB advisory.

Reusable foundation: `Button`, `StudentAvatar`, semantic native disclosures, domain question/answer types, existing palette, API/state adapters and actual error handling. Reused Button/avatar directly; existing live components were preserved for incremental integration.

## Stage 1 — visual direction and implemented experience

Warm off-white canvas, sage actions, deep forest text, subtle borders, restrained corners, system typography with occasional editorial serif accents. Persistent desktop sidebar becomes compact top navigation on mobile. The educational flow is the primary information hierarchy; no streaks, fabricated analytics or marketing dashboard.

References: retrieved the public Brilliant, Speak and Linear websites. Adapted question-first focus, uncluttered student conversation and structured navigation/history. No reference branding/assets were copied; the avatar comes from this project.

### Screens and interactions

1. **Dashboard:** topic/notes form, validation, three sample subject shortcuts, start action, recent sessions and a new-user empty-state switch. Fixed fixture subject is stated explicitly even when the title is customized.
2. **Assessment:** shared controlled presentation for all six questions; progress, answer/working, uncertainty, back/next/skip, tab-held draft indication and pause. State explorer shows loading and failure; submission briefly demonstrates the transition. Retry preserves local responses. Sample-answer shortcut is in the explorer.
3. **Conversation:** existing Alex avatar, local microphone-shaped state control, connection-state selector, focus concepts, sample dialogue reveal, muted/disconnected/error states and retry. Text entries are retained locally without generated AI replies. Subtle listening/speaking animations respect reduced motion.
4. **Results:** clearly fixed 3/6 → 5/6 example, per-concept comparison, strengths/remaining practice, six sample response/feedback reviews, separately labeled ungraded local drafts/text entries, sample transcript, optional before/after self-report and finish/new-practice actions. No mastery or anxiety-reduction claim.
5. **History:** biology, recursion and probability fixtures; recency/status, search/filter, resume/review and one current local demonstration. Completing it changes only the preview tab’s row.

All visible controls have a local action, navigation target, native disclosure or meaningful disabled state. Stage links and the top selector deliberately permit jumping ahead for design inspection.

### Approved decluttering follow-up

Removed the sidebar workspace blurb and slogan, footer tagline, dashboard explainer card, assessment reassurance panel, redundant conversation guidance and dashboard introductory slogan. The dashboard now has one focused content column; the assessment retains only its useful rating/state controls beside the question. The sample subject and ungraded-input notice remain compactly below the assessment. Conversation focus concepts and transcript remain visible.

Changed `PreviewLayout.tsx`, `PreviewDashboard.tsx`, `PreviewAssessment.tsx`, `PreviewConversation.tsx` and `preview.css`; removed obsolete style rules and adjusted spacing. Typecheck and build passed; lint retains its pre-existing warning. Production-browser checks passed for six views at four widths, automated accessibility scans, keyboard/reduced-motion behavior, preview interactions, storage isolation and live-route smoke checks. Updated desktop/mobile screenshots inspected. This is a Stage 1 presentation revision; the Stage 2 review gate still applies.

### Access and short demo script

```sh
npm run dev
```

Open `http://localhost:5173/preview` (or the printed Vite port). No backend or `.env` is needed for this route.

1. Choose **Biology**, optionally edit the title/notes, and start.
2. Write or use a sample answer, mark uncertainty, and move through the baseline. Skip is an explicit local action. Use the state explorer to demonstrate failure/retry.
3. Start the **sample** conversation; preview listening/muted/speaking, reveal messages, and add a text entry. No microphone permission or audio is involved.
4. Open the follow-up; answer/skip three different questions.
5. Inspect the **fixed example** comparison and separately review your ungraded inputs. Choose an optional reflection rating, then finish.
6. Search/filter history and open another example. Use the **LIVE** link to reach the existing application.

Direct routes: `/preview`, `/preview/practice`, `/preview/baseline`, `/preview/conversation`, `/preview/followup`, `/preview/results`, `/preview/history`. Refreshing a deep link resets to the default heart fixture on that screen. Static hosting needs an SPA fallback for these paths as for the live routes.

### Functionality boundaries

- **LIVE:** existing practice API, Gemini generation/grading, ElevenLabs adapter, actual browser references/drafts and real results. Their presence is not a claim of a verified full live cycle.
- **PREVIEW:** every sample question, score, educational feedback, student message and prior-history entry. Custom answers/text/rating values are local input, never assessed by the fixture score. One local demonstration replaces the previous one when another sample is opened or a new practice begins.
- **PLANNED:** use this design on live screens; independent text-only AI conversation; robust transcript finalization, backend-operation protection and other reliability work below.

Preview data does not survive refresh, leaving the preview root, or opening another demonstration. Within the active demonstration, assessment drafts/working/skips, nervousness and local conversation entries survive preview navigation and pause/resume. This is a visual prototype, not durable persistence.

## Files and architecture impact

| File | Change / responsibility |
| --- | --- |
| `src/app/App.tsx` | Added independent lazy `/preview/:screen?` route outside production providers. Existing routes preserved. |
| `src/features/preview/PreviewApp.tsx` | Local orchestration, fixture selection, drafts, navigation and one current sample-history row. |
| `src/features/preview/PreviewLayout.tsx` | Sidebar/mobile nav, explicit mode banner, screen selector, title/focus handling and practice-stage links. |
| `src/features/preview/PreviewIcon.tsx` | Small original inline SVG icon set; no dependency or asset download. |
| `src/features/preview/previewFixtures.ts` | Three deterministic sample subjects, concept pairs, scores, dialogue and local state types. |
| `src/features/preview/PreviewDashboard.tsx` | Dashboard, reusable session rows, history search/filter and empty states. |
| `src/features/preview/AssessmentView.tsx` | Controlled reusable question presentation typed with public `PracticeQuestion`/`AssessmentAnswer`. |
| `src/features/preview/PreviewAssessment.tsx` | Preview-only timing/failure/rating controls wrapping the presentation. |
| `src/features/preview/PreviewConversation.tsx` | Sample visual connection modes/transcript/text controls; no voice SDK. |
| `src/features/preview/PreviewResults.tsx` | Example educational comparison and separately labeled local reflection/reviews. |
| `src/features/preview/preview.css` | Prototype-scoped tokens, layouts, controls, breakpoints, motion and focus styles. |
| `README.md`, `AGENTS.md`, this document | Access instructions, verified checkpoint, code-based audit and gated roadmap. |

No removed files. No server, shared contracts, production session state/service code, package or lockfile changes. Preview is separately chunked (~41 kB JS / 11.5 kB gzip after decluttering); the original live CSS retains its baseline asset hash. Its scoped styles also remain harmless after navigating from preview to live.

### Contract mapping for approved integration

| Presentation | Existing live binding |
| --- | --- |
| Topic/notes | `CreatePracticeInput` → existing `createSession`; actual preparation/clarification/error UI remains. |
| Question card | `AssessmentAttempt.questions`, `.answers`, `.currentQuestionIndex` → `AssessmentView` props; `updateDraft` and `submitAssessment` remain the operations. |
| Pausing/history | `PracticeSession.stage/lifecycle/updatedAt` and existing `saveAndExit`/`resumeSession`; display only browser-known sessions and genuine unavailable errors. |
| Focus/transcript | `PracticeCycle.focusConceptIds`, public concepts, actual SDK events, `ConversationSegment.messages/transcriptStatus`; no invented activity. |
| Results | Actual `AssessmentGrade`/`QuestionGrade`, matching concept IDs and stored answers; render absent/error grades honestly, never fall back to sample scores. |
| Self-report | `nervousnessBefore`/`nervousnessAfter` → existing `setNervousness`. |

When approved, move genuinely shared views/tokens out of the preview feature and inject production values/callbacks. Keep sample orchestration/fixtures on the preview side. Conversation and results currently combine preview presentation with fixture controls; extract controlled views before binding them. No API rewrite or second production store is required.

## Verification and known limitations

Final source checks: typecheck passes; lint has only the original warning; all 8 tests pass; production build passes with the original large live-chunk warning. No additional dependencies installed.

Using existing external Playwright/axe tooling and headless Microsoft Edge against the production build:

- All six views render; no horizontal overflow at 320, 390, 768 and 1440 px.
- Automated WCAG A/AA scans passed across those 24 combinations, plus expanded assessment failure and conversation error/text controls. A results-label contrast issue discovered by the scan was corrected.
- Full preview path passed: validation/empty state, keyboard start/navigation, drafts/working/uncertainty, skips, pause/resume, simulated evaluation failure/retry, all six conversation states, text entry/reveal, recheck, reviews, reflection, finish, history search/filter and screen selector.
- Reduced-motion animation suppression checked directly.
- Zero preview `/api`/provider requests and zero microphone requests; a seeded test production snapshot stayed byte-for-byte unchanged, even with restorable sessions present.
- No preview runtime errors. Refresh resets demonstration state.
- Live Home and unavailable study/results recovery routes passed; live baseline draft/navigation passed with an injected UI test fixture. This is not a full live/provider test.
- Desktop/mobile screenshots captured and visually inspected for the dashboard, assessment, conversation, results and history.

Browser script/screenshots are local verification artifacts under `C:\Users\fahim\AppData\Local\Temp\opencode\feynman-browser-check` (`redesign-check.mjs`, `redesign-*-desktop.png`, `redesign-*-mobile.png`). They are not a new repository test framework.

Outstanding: full live Gemini → ElevenLabs → recheck browser flow and real audio/history retrieval remain unverified; live server persistence remains process-memory only; existing lint/chunk warnings remain. Preview samples are intentionally narrow, fixed and ungraded. Only one active local demonstration is retained. Automated accessibility checks do not substitute for a full assistive-technology review.

## Stage 2 — approved presentation integration (not started)

1. **Shell + Home:** promote scoped approved tokens/layout, retain routes and one `SessionProvider`. Bind start to `createSession` and actual errors/clarification. Acceptance: arbitrary live subject starts, real history stays intact, navigation preserves drafts.
2. **Assessment:** connect `AssessmentView` to `AssessmentAttempt` and `updateDraft`/`submitAssessment`; retain stage/lifecycle guards, real busy state and retries. Acceptance: baseline/recheck both work; pause/refresh/failed grading preserve exact answers and working.
3. **Results + history:** feed comparisons from actual grades by concept ID, map genuine transcripts/readiness and lifecycle. Acceptance: no missing grade becomes an example; no sample entry appears in live history; finish works.
4. **Conversation:** separate preview controller from controlled conversation view, then connect existing `TeachingPanel`/SDK events and signed credentials. Acceptance: mute/status/error/send/exit/recheck behave as before and only genuine events animate live activity.
5. **Cleanup:** remove redundant old presentation only after each slice is verified. Re-run typecheck/lint/tests/build and targeted browser checks per slice; keep a quick return path during review.

**Next smallest approved change:** integrate only the sidebar/dashboard presentation on live Home. Stop for review before the assessment slice if requested.

## Stage 3 — reliability priorities (not started)

1. Verify a full live conversation with configured private agent/Gemini model: permission, connection, contextual response, interruption, mute, disconnect and final history.
2. Finalize/register transcript explicitly before depending on it; reconcile ordered finalized turns and report pending/incomplete states.
3. Handle ElevenLabs processing delays with bounded retry/polling and a genuine retry action rather than treating disconnect as readiness.
4. Evaluate all three typed answers in one validated structured Gemini batch where feasible; preserve per-question expected answers/rubrics/evidence and deterministic server totals.
5. Improve quota/503/time-out recovery with preserved drafts, useful sanitized errors and bounded retry behavior.
6. Prevent duplicate submissions and conflicting server operations; client queues alone do not protect concurrent backend requests.
7. Implement a real text-only AI alternative independent of voice connection if approved; preserve the private focus-context boundary.
8. Handle backend restart/missing sessions explicitly; distinguish local drafts from resumable server sessions and offer an honest fresh-start path.
9. Test grading correctness and matched-question comparability with representative complete, partial, incorrect, skipped and unsupported-evidence answers.

Acceptance for every item requires actual behavior/tests, not the presence of contracts or placeholders. Durable storage remains a separate scope decision.

## Stage 4 — hackathon demonstration readiness (not started)

- Run complete live browser smoke cycles and failure/recovery paths on the demo laptop.
- Check mobile, keyboard order/focus, screen-reader labels and reduced-motion behavior after live integration.
- Verify private provider credentials, agent settings and quota with actual successful calls.
- Document two-terminal setup and stable local ports; rehearse backend-restart recovery.
- Re-run typecheck/lint/tests/build; address critical defects and feature-freeze.
- Rehearse a 2–3 minute honest demo: topic → baseline → explanation → matched recheck → reflection. Record a real successful session as a fallback; label preview demonstrations clearly.
- If deployment is approved, prepare HTTPS microphone support, SPA fallbacks and production API routing. Do not deploy automatically.

**Review gate:** approve the design and the first Stage 2 slice before continuing.
