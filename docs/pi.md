# Using EGM with Pi

This package ports the [Elephant-Goldfish Model (EGM)](https://github.com/google/elephant-goldfish-model)
to the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent).

## What is different on Pi

This repository is a Pi package: the EGM skills, reviewer personas, and document
standards are vendored content, while the harness-specific behavior lives in a
Pi extension (`extensions/`) that registers two tools on session start. Instead
of your harness's native subagent and question tools, Pi sessions drive EGM
through these extension-registered tools: `egm_goldfish` (zero-context reviewer
spawning) and `egm_ask` (single-select interactive gates). The vendored skill
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

## Support status

Experimental: this is Phase 1 of the port. Vendored content tracks upstream at
pinned revision `a8380ab` (see `UPSTREAM.md`). The extension-side review
plumbing is functional, but upstream test suites and remaining harness
integrations are still being ported; expect rough edges and report them.
