# pi-elephant-goldfish

**Elephant-Goldfish Model (EGM) for the Pi coding agent: draft specs with a deep-context Elephant, stress-test them with zero-context Goldfish reviewers.**

## What it is

A [Pi coding agent](https://github.com/earendil-works/pi-coding-agent) package that ports the
[Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model) (EGM), Google's
spec-driven design workflow: your main session (the **Elephant**) drafts and refines design
documents, then spawns fresh, zero-context reviewer subagents (**Goldfish**) that judge the
document with no stake in it being good. All EGM content — skills, reviewer personas, and
document standards — is vendored verbatim from
[`google/elephant-goldfish-model`](https://github.com/google/elephant-goldfish-model) @ `a8380ab`
(Apache-2.0; not an officially supported Google product). The concept comes from
[Dave Rensin's original essay](https://medium.com/@drensin/elephants-goldfish-and-the-new-golden-age-of-software-engineering-c33641a48874).

## Features

### Skills (one `/egm-*` command each)

| Command | Skill | Purpose |
| --- | --- | --- |
| `/egm-brainstorm` | `skills/egm-brainstorm` | Interactive ideation: drills into a half-baked concept one question at a time, then writes a consolidated `concepts_brief.md`. |
| `/egm-draft` | `skills/egm-draft` | Drafts a design document section-by-section from a concepts brief, with a human gate after each section. |
| `/egm-review` | `skills/egm-review` | Runs the five-stage Goldfish review protocol on a design document (stages 5→9, consolidated report + verdict). |
| `/egm-review-loop` | `skills/egm-review-loop` | Antagonistic review loop against a document standard until findings converge. |
| `/egm-resolve` | `skills/egm-resolve` | Resolves Goldfish findings (CONTEST / ESCALATE / PROPOSE FIX / DECLINE) into approved document edits. |
| `/egm-drift-report` | `skills/egm-drift-report` | Detects drift between design documents and the code as it actually is. |
| `/egm-bootstrap` | `skills/egm-bootstrap` | Bootstraps EGM contract `README.md` files across a repository subtree (BFS discovery, safety gate, parallel workers, verification). |

### Tools (harness-specific mechanisms, registered by the extension)

| Tool | Upstream mechanism | What it does on Pi |
| --- | --- | --- |
| `egm_ask` | `ask_question` gate | Single-select interactive gate (one question, 2–8 options); renders a native SelectList in the TUI, falls back to plain chat headless. |
| `egm_goldfish` | Antigravity `invoke_subagent` / Claude `Agent` / Codex `spawn_agent` | Spawns zero-context reviewers as read-only `pi --print` subprocesses, fans them out in parallel, and writes the consolidated report to the artifact directory. |
| `egm_bootstrap` | Upstream `egm-bootstrap` recursive sub-orchestrator | Recursive directory documentation: discovery, >15-dir safety gate, partitioning, parallel read/write workers, JSON validation, root roll-up, final verification pass. |
| `egm_state` | Harness-review pause/resume pipeline state | Persists or returns the review pipeline state as durable, branch-aware session entries (survives compaction and branching). |

### Artifact-first behavior

Large content never floods the chat: briefs, drafts, stage reports, and bootstrap reports are
written as files (`concepts_brief.md`, `design_draft.md`, `*_report.md`, `bootstrap_report.md`)
and the session is notified of the path, then yields the turn.

## Install

Requirements: Pi >= 1.4.0 (tested against 1.4.0). Reviews spawn zero-context `pi --print`
children, so the `pi` binary must be on `PATH`.

**Option A — from a published git repository** (placeholder: `nsanta` pending repo publish):

```sh
pi install git:github.com/nsanta/pi-elephant-goldfish
```

**Option B — development, from a clone of this repository:**

```sh
git clone <this-repo> && cd pi-elephant-goldfish
npm install
pi -e .
```

## Quickstart

From a project directory with the package loaded:

1. **Brainstorm** — refine an idea into a reviewed concepts brief:

   ```
   /egm-brainstorm a background-job retry queue with dead-letter handling
   ```

   The Elephant drills in one question at a time, fans out six Goldfish lenses, and writes
   `concepts_brief.md` to the artifact directory.

2. **Draft** — turn the brief into a design document, section by section:

   ```
   /egm-draft concepts_brief.md
   ```

   You approve each section at a gate; the result lands in `design_draft.md`.

3. **Review** — stress-test the draft with zero-context Goldfish:

   ```
   /egm-review design_draft.md uninterrupted
   ```

   Five review stages run through parallel Goldfish children; each stage writes a `*_report.md`
   and the final consolidated report carries a 🔴 Blocker / 🟡 Major / 🟢 Nit tally table and a
   verdict. Resolve findings with `/egm-resolve goldfish_review_report.md`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `EGM_ARTIFACT_DIR` | working directory | Directory for briefs, drafts, and reports. Also settable via an `EGM artifact directory: <path>` line in `AGENTS.md`. |
| `EGM_GOLDFISH_TIMEOUT_MS` | `900000` | Timeout for each spawned Goldfish reviewer child. |
| `EGM_GOLDFISH_MAX_CONCURRENT` | `3` | Maximum number of Goldfish children running at once. |
| `EGM_BOOTSTRAP_TIMEOUT_MS` | `900000` | Timeout for each spawned bootstrap worker child. |
| `EGM_BOOTSTRAP_MAX_CONCURRENT` | `3` | Maximum number of bootstrap workers running at once. |

`EGM artifact directory:` in `AGENTS.md` — the upstream convention works unchanged: if the
project's `AGENTS.md` contains a line `EGM artifact directory: .dev/docs`, EGM writes its
artifacts there instead of the working directory.

## How it works

- Each `/egm-*` command loads the vendored skill's `SKILL.md` (frontmatter stripped) as your
  message, so the model follows the upstream instructions directly.
- When a skill says "spawn a subagent and name a persona", the extension launches a fresh
  `pi --print` subprocess — genuinely zero conversation context — restricted to read-only tools,
  which reads the persona file from this package before judging.
- Reviewers are fanned out in parallel and their findings are normalized and deduplicated by the
  extension, so no reviewer ever nests another subagent.
- Skills pause at explicit human gates (single-select questions via `egm_ask`); large output goes
  to artifact files, never chat dumps.
- Long reviews persist their pipeline state as durable session entries (`egm_state`), so pause,
  resume, compaction, and branching are safe.

Port architecture and design decisions: [PLAN.md](PLAN.md). Harness guide for daily use
(delegation mapping, bootstrap details, known limits): [docs/pi.md](docs/pi.md).

## Development

```sh
npm install                          # dependencies (vitest, typescript)
npm test                             # unit + content-adjacent tests; integration skipped
npm run check:content                # frontmatter + relative-link integrity
EGM_E2E=1 npx vitest run tests/integration   # env-gated E2E against the real pi CLI (uses model quota)
./scripts/sync-upstream.sh           # re-vendor content from a local upstream clone + scripted adaptations
```

The recorded harness verification evidence lives in [TESTING.md](TESTING.md); upstream
provenance and the sync workflow in [UPSTREAM.md](UPSTREAM.md).

## License

Apache-2.0. This is an independent port of EGM for the Pi coding agent; it is not a Google
product and is not officially supported by Google. Vendored content inherits Apache-2.0 from
[google/elephant-goldfish-model](https://github.com/google/elephant-goldfish-model).
