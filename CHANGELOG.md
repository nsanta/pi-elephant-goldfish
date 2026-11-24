# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-23

### Added

- EGM port for Pi: `/egm-brainstorm`, `/egm-draft`, `/egm-review`, `/egm-review-loop`, `/egm-resolve`, `/egm-drift-report`, and `/egm-bootstrap` skills, vendored from `google/elephant-goldfish-model` @ `a8380ab` (Apache-2.0).
- Pi extension (`egm-core.ts`) registering the harness-specific tools:
  - `egm_ask` — single-select interactive gate (2–8 options, `(Recommended)` markers stripped; native SelectList in the TUI, plain-chat fallback headless).
  - `egm_goldfish` — zero-context reviewer fan-out as read-only `pi --print` subprocesses, parallel execution, consolidated findings report.
  - `egm_bootstrap` — recursive EGM contract `README.md` bootstrapping (BFS discovery, >15-directory safety gate, parallel workers, final verification pass).
  - `egm_state` — durable, branch-aware review pipeline state that survives compaction and branching.
- Reviewer persona library (`zoom_out`, `design_critic`, `comprehension`, `structural`, `style`, `synthesizer`, `codebase_details`, `implementation_readiness`, `bootstrap_orchestrator`) and document standards (feature-spec, Heilmeier, implementation-readiness, re-implementation, zoom-out).
- Structured artifact layout: per-design artifact directories (`<artifact-dir>/egm/<feature-slug>/`), `EGM_ARTIFACT_LAYOUT=flat` escape hatch.
- Artifact generation: briefs, drafts, and reports are written to files and the session is notified of the path — large content never floods the chat.
