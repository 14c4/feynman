# Claude Code — feynman.ai

@AGENTS.md

`AGENTS.md` provides the project's technical architecture and development guidelines. The current codebase is the source of truth.

## Product Vision

**feynman.ai — Learn by explaining. Prepare with confidence.**

feynman.ai is an AI-powered learning and exam-readiness platform focused on helping students manage uncertainty and test-related anxiety.

The core experience uses the Feynman Technique: students assess their knowledge, teach concepts to Alex (an AI student), and complete a follow-up assessment to evaluate their understanding.

Our goal is to go beyond traditional studying by helping students explore three dimensions of exam readiness:

- **Knowledge:** What students genuinely understand and where they struggle.
- **Confidence:** How prepared students feel compared with their demonstrated understanding.
- **Physiological responses:** Optional, consent-based measurements through Presage SmartSpectra to explore changes during learning and assessment.

Future development should emphasize realistic exam preparation, configurable timed assessments, confidence tracking, and thoughtful Presage integration.

**Health-track positioning:** feynman.ai aims to support students experiencing test-related stress through low-pressure learning, structured practice, and greater awareness of their readiness.

The platform is not a medical diagnostic or anxiety-treatment tool. Physiological signals must not be presented as definitive measurements of anxiety, and health benefits must not be claimed without validation.

## Development Principles

- Prioritize the user's current request over historical milestones.
- Preserve existing functionality and integrations.
- Inspect only relevant files; avoid repeated full-codebase audits.
- Implement directly when requirements are clear.
- Prefer focused testing over unnecessarily exhaustive verification.
- Keep the UI modern, calming, intuitive, and distraction-free.
- Preserve the distinction between real, simulated, and unavailable data.
- Make camera functionality optional, privacy-conscious, and consent-based.
- Avoid unnecessary rewrites, excessive narration, and unrelated features.
- Treat future roadmap features as direction, not automatic tasks.

## Boundaries

- Never expose credentials or sensitive data.
- Do not make paid API calls, commit, push, or deploy without authorization.
- Keep mock and live integrations explicitly separated.
- Do not sacrifice the functioning learning experience for experimental features.

## Completion

Briefly summarize what changed, what was verified, and any remaining blockers.

**Build toward a learning experience that helps students understand their knowledge, evaluate their readiness, and approach exams with greater confidence.**