# Claude Code — feynman.ai

@AGENTS.md

Read `AGENTS.md` first; it is the current cross-agent project contract. For a factual checkpoint and evidence, read `docs/claude-handoff-audit.md` and `docs/functional-integration.md`. The earlier design notes in `docs/frontend-redesign.md` are reference material, not today's task list.

## Operating mode

**Goal: make one complete study cycle work.** Do not spend time polishing the preview, proposing new health-track pivots, rebuilding the app, or adding unrelated features unless asked. The user wants working software more than plans.

At the beginning of a new session:
1. Run `git status --short` and inspect recent diffs. Preserve teammates' and previous agents' changes.
2. Inspect `package.json`, relevant code, and the latest checkpoint documents. Do not trust historical unchecked roadmap boxes over live code.
3. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` to establish a baseline. Separate environment failures from code failures.
4. State a concrete next task, the files involved, and observable acceptance checks in a few lines. **When the user has already asked you to implement that task, proceed**; don't ask permission twice.

For implementation: tackle **one vertical slice** (UI → session state → API → provider/mock → tests). Afterward report *implemented / verified / still mocked / blocked*, with commands and results. Prefer making the smallest reliable change over introducing new architecture. If a check fails, fix or explicitly report it; don't call it complete.

## Boundaries

- Do not commit, push, merge, deploy, modify billing or spend Gemini/ElevenLabs credits without explicit instruction.
- Never print, paste, inspect unnecessarily, or send the contents of `.env` or other secret files to outputs/logs. Environment keys stay server-side; never use `VITE_` for them. Be aware the original uploaded ZIP included `.env`: **do not redistribute it**.
- Development mock must remain opt-in, labeled `DEV MOCK`, and impossible to enable in production. Mock grades must never be passed off as real results.
- Never fake microphone activity, real voice transcripts, evaluation results or provider success.
- If a feature depends on a paid live call, use a deterministic local/injected test where possible and request permission before spending credits.
- Preserve private answer keys, reserved follow-up questions and access tokens; the client gets only approved public session data.
- Do not use broad autonomous parallel edits to shared contracts without an agreed file-owner split. Avoid unnecessary package/framework changes.
- This is an educational study application with optional self-reported nervousness. Do not make claims of treating or diagnosing anxiety.

## Immediate milestone

First make the **development mock** exercise the complete non-voice flow: topic → preparation → baseline → evaluation → transparently labeled teaching *bypass for test only* → matched recheck → evaluation → results. Do not invent a simulated speech conversation. Wire the approved assessment presentation for the recheck and the real score/results data. Add an automated full-cycle API test and browser smoke test. Keep real teaching gated by actual ElevenLabs configuration and tested separately.

After that, tackle a functional independent text conversation and ElevenLabs lifecycle/final transcript recovery as clearly scoped follow-up tasks. See `AGENTS.md` for acceptance criteria and order.

## Concise handoff format

End each task with:
- **Works now** — user-visible behavior, specific route/stage.
- **Verified** — commands + results; whether real providers were called.
- **Not working** — honest blockers and reproducible failures.
- **Files changed** — exact files and why.
- **Next smallest task** — one unambiguous action, not a feature wishlist.
