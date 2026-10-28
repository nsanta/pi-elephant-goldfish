# Using EGM with Pi

This package ports the [Elephant-Goldfish Model (EGM)](https://github.com/google/elephant-goldfish-model)
to the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent).

## What is different on Pi

This repository is a Pi package: the EGM skills, reviewer personas, and document
standards are vendored content, while the harness-specific behavior lives in a
Pi extension (`extensions/`) that registers three tools and a set of `/egm-*`
commands on session start. Instead of your harness's native subagent and
question tools, Pi sessions drive EGM through these extension-registered tools:
`egm_goldfish` (zero-context reviewer spawning), `egm_bootstrap` (recursive
directory documentation), `egm_ask` (single-select
interactive gates), and `egm_state` (durable pipeline state); the `/egm-*`
commands start each vendored skill by name (see [Commands](#commands)). The
vendored skill
text is byte-identical to upstream except for minimal scripted adaptations
(see `UPSTREAM.md` and `scripts/adapt-pi.mjs`); never hand-edit vendored files.

## Install

From a published git repository:

```sh
pi install git:github.com/<owner>/pi-elephant-goldfish
```

For development, load the extension from a checkout of this repository:

```sh
pi -e .
```

## Delegation mapping

| Upstream harness mechanism | On Pi |
| --- | --- |
| Antigravity `invoke_subagent` | `egm_goldfish` tool |
| Claude Code `Agent` tool | `egm_goldfish` tool |
| Codex `spawn_agent` | `egm_goldfish` tool |
| Bootstrap recursive sub-orchestrator workers | `egm_bootstrap` tool |
| `ask_question` gate | `egm_ask` tool |
| Named personas (harness-registered subagent types) | Persona-file loading inside zero-context `pi --print` children |
| Synthesizer nesting (subagents spawning subagents) | Extension-side fan-out/fan-in |

`egm_goldfish` launches `pi --print` subprocesses with no conversation history,
restricted to read-only tools, and instructs each child to read the requested
persona file from this package first. The extension fans reviewers out in
parallel, collects their reports, and normalizes and deduplicates the findings
itself, so no reviewer ever needs to nest another subagent.

## Artifact directory

By default EGM writes briefs, drafts, and reports to the working directory of
the session. The upstream `AGENTS.md` convention still works: if the project's
`AGENTS.md` contains a line `EGM artifact directory: <path>`, EGM writes its
artifacts to that folder instead.

## Commands

The extension registers seven `/egm-*` commands, one per vendored skill. Each
command reads the skill's `SKILL.md`, strips the YAML frontmatter, and sends
the body as your message (with your command arguments appended), so the model
receives the upstream instructions directly. This is equivalent to running the
corresponding `/skill:egm-<name>` skill command, but works identically in TUI,
RPC, JSON, and print modes.

| Command | Skill | Purpose |
| --- | --- | --- |
| `/egm-brainstorm` | `skills/egm-brainstorm` | Interactive ideation and refinement of a half-baked concept. |
| `/egm-draft` | `skills/egm-draft` | Draft a design document section-by-section from a concepts brief. |
| `/egm-review` | `skills/egm-review` | Run the five-stage Goldfish review protocol on a design document. |
| `/egm-review-loop` | `skills/egm-review-loop` | Run the antagonistic review loop against a document standard. |
| `/egm-resolve` | `skills/egm-resolve` | Resolve Goldfish findings into approved document edits. |
| `/egm-drift-report` | `skills/egm-drift-report` | Detect drift between design documents and the code. |
| `/egm-bootstrap` | `skills/egm-bootstrap` | Bootstrap EGM directory READMEs across a repository subtree. |

Arguments pass through verbatim. For example, `/egm-review
docs/designs/foo.md uninterrupted` runs the review pipeline on that document
with the uninterrupted preset.

## Tools

| Tool | Role |
| --- | --- |
| `egm_ask` | Single-select interactive gate for EGM workflows (one question, 2-8 options). Falls back to plain chat when no interactive UI is available. |
| `egm_goldfish` | Spawns zero-context Goldfish reviewers as read-only `pi --print` subprocesses, fans them out in parallel, and writes the consolidated report to the artifact directory. |
| `egm_bootstrap` | Recursively bootstraps EGM contract `README.md` files: discovery, safety gate, pruning, partitioning, parallel read-and-write worker subprocesses, JSON return validation, root roll-up, and a mandatory final verification pass. See [Bootstrap](#bootstrap). |
| `egm_state` | Persists or returns the EGM review pipeline state for the current session branch (stored as durable session entries, so a long review survives compaction and branching). |

The review pipeline itself is model-driven from the vendored skill text; the
tools only provide the harness-specific mechanisms the skills describe.

## Environment knobs

| Variable | Default | Meaning |
| --- | --- | --- |
| `EGM_ARTIFACT_DIR` | working directory | Directory for briefs, drafts, and reports. Also settable via an `EGM artifact directory: <path>` line in `AGENTS.md`/`CLAUDE.md`. |
| `EGM_GOLDFISH_TIMEOUT_MS` | `900000` | Timeout for each spawned Goldfish reviewer child. |
| `EGM_GOLDFISH_MAX_CONCURRENT` | `3` | Maximum number of Goldfish children running at the same time. |
| `EGM_BOOTSTRAP_TIMEOUT_MS` | `900000` | Timeout for each spawned `egm_bootstrap` worker child. |
| `EGM_BOOTSTRAP_MAX_CONCURRENT` | `3` | Maximum number of bootstrap worker children running at the same time. |

## Bootstrap

`egm_bootstrap` ports the upstream `egm-bootstrap` root orchestrator. Call it
with `path` (the subtree to document, required) and optionally
`targetFilename` (default `README.md`). The extension performs,
deterministically: level-by-level BFS discovery (hidden/ignored directories
skipped, `.gitignore`/`.egmignore` basenames honored), bottom-up pruning of
non-code and test-only directories, adaptive partitioning, and a final
verification pass. Documentation itself is written by fresh `pi --print`
workers restricted to `read,grep,find,ls,write,edit` tools; each worker must
end with a JSON `subtree_index` payload (one retry on invalid output, then
placeholder entries), and a final root-compiler child rolls everything up into
the root blueprint.

Safety gate: when more than 15 directories survive pruning and `approved` is
not `true`, the tool returns an approval request instead of running. Present
it to the user with `egm_ask`, and only re-call `egm_bootstrap` with
`approved: true` after explicit approval.

The result reports the number of contract files written/corrected, the
verification violation count, and the report path
(`<artifact dir>/bootstrap_report.md`); read the report file for per-worker
status and every violation.

## Support status

Experimental: this is Phase 4 of the port. Vendored content tracks upstream at
pinned revision `a8380ab` (see `UPSTREAM.md`). The extension-side review
plumbing and the `/egm-*` commands are functional, but upstream test suites
and remaining harness integrations are still being ported; expect rough edges
and report them.
