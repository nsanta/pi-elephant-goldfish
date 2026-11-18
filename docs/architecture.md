# Architecture

How the pi-elephant-goldfish extension works internally: package layout, the
extension entry point, each registered tool, and how Goldfish reviewer agents
are created at runtime. For daily-use guidance (delegation mapping, artifact
directory, known limits) see [pi.md](pi.md); for port design decisions see
[PLAN.md](../PLAN.md); for upstream provenance see [UPSTREAM.md](../UPSTREAM.md).

## 1. Big picture

This is a **Pi package** (`package.json` → `"pi": { "extensions": ["extensions/*.ts"], "skills": ["skills/*"] }`)
with two halves:

- **Vendored upstream content** (pure markdown, from `google/elephant-goldfish-model`):
  skills, reviewer personas, and document standards — the *what to do*.
- **The Pi extension** (TypeScript under `extensions/`): the *how to do it on Pi* —
  tools, commands, and subprocess spawning.

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Pi coding agent                             │
│                                                                       │
│  package.json ──► loads extensions/*.ts ──► egm-core.ts               │
│                                             (single entry point)      │
│                                                  │ registers          │
│      ┌────────────────┬───────────────┬──────────┼───────────────┐    │
│      ▼                ▼               ▼          ▼               ▼    │
│ /egm-* commands   egm_ask tool   egm_goldfish  egm_bootstrap  egm_state│
│ (7 aliases)       (human gate)   (reviewers)   (doc workers)  (state) │
└────────┬─────────────────┬────────────────┬──────────────┬───────────┘
         │                 │                │              │
         ▼                 │                ▼              │
  skills/egm-*/SKILL.md    │      spawns fresh `pi --print`    │
  (vendored upstream)      │      child processes              │
         │                 │                │                   │
         └─── instructs the model ─────► uses these tools ─────┘

  Vendored assets read at runtime by the extension:
    agents/*.md                    ← reviewer personas
    resources/document_standards/* ← document standards
```

Key design decision: **the workflow is model-driven**. The TypeScript code
contains no review logic — it only provides mechanisms (spawn, gate, persist).
The *protocol* lives in the vendored `SKILL.md` prose, which the model follows.
This keeps the vendored files byte-identical to upstream (except minimal
scripted adaptations) as the single source of truth.

## 2. Package layout

| Path | Role |
| --- | --- |
| `extensions/egm-core.ts` | Only top-level extension entry point; registers everything below. |
| `extensions/lib/commands.ts` | The seven `/egm-*` skill-alias commands. |
| `extensions/lib/ask-options.ts` | `egm_ask` option normalization (pure module). |
| `extensions/lib/goldfish.ts` | `egm_goldfish` reviewer spawning + report building. |
| `extensions/lib/bootstrap.ts` | `egm_bootstrap` deterministic pipeline + tool registration. |
| `extensions/lib/worker-run.ts` | Read-write worker child runner + bounded-concurrency pool (shared by bootstrap). |
| `extensions/lib/state.ts` | `egm_state` durable branch-aware pipeline state. |
| `extensions/lib/paths.ts` | Package-root derivation, persona/standard alias resolution. |
| `extensions/lib/artifact-dir.ts` | Artifact-directory and layout resolution (`flat`/`structured`), slug normalization, report-collision suffix, env knob parsing. |
| `skills/egm-*/SKILL.md` | Vendored EGM skills (one `/egm-*` command each). |
| `agents/*.md` | Vendored reviewer personas (zoom_out, comprehension, design_critic, implementation_readiness, structural, style, codebase_details; plus synthesizer and bootstrap_orchestrator roles that never spawn as reviewers). |
| `resources/document_standards/*.md` | Vendored document standards enforced by reviewers in review-loop workflows. |

## 3. Extension entry point

`extensions/egm-core.ts` exports a default `egmCore(pi: ExtensionAPI)` that Pi
invokes on session start. It registers:

- `/egm-version` — prints the package version.
- `egm_ask` — single-select interactive gate (TUI SelectList dialog or
  plain-chat fallback; see §5).
- `egm_goldfish` — zero-context reviewer spawning (see §4).
- `egm_bootstrap` — recursive EGM README generation (see §6).
- `egm_state` — durable pipeline state (see §7).
- the seven `/egm-*` commands (see §8) via `registerEgmCommands(pi)`.

Support modules live under `extensions/lib/` and are imported relatively;
`extensions/*.ts` stays the only top-level entry point.

## 4. How Goldfish agents are created (`egm_goldfish`)

There are **no registered agents**. A Goldfish reviewer is a **persona markdown
file** plus a **fresh `pi --print` subprocess** with no session, no history,
and read-only tools. Its entire world is a prompt composed by the extension.

```
Model calls: egm_goldfish { reviewers: ["zoom_out","design_critic","style"],
                            targetFile: "design_draft.md",
                            standards: { "style": "feature-spec-standard" } }
        │
        ▼
┌─ Validation phase ──────────────────────────────────────────────┐
│ resolvePersona() / resolveStandard()  (lib/paths.ts)            │
│   • alias table: "zoom_out" → <pkg>/agents/zoom_out.md          │
│   • accepts file paths too (name contains "/")                  │
│   • REJECTS "synthesizer"/"bootstrap_orchestrator" with an      │
│     instructive error (those roles are built in, not reviewers) │
│ findPiBinary() — `pi` must exist on PATH, else hard fail:       │
│   "a review in the same context is not a Goldfish review"       │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ Fan-out (bounded concurrency, default 3) ──────────────────────┐
│   worker pool pulls reviewers off a shared index                │
│                                                                 │
│   per reviewer: buildChildPrompt() composes a SELF-CONTAINED    │
│   prompt:                                                       │
│   ┌───────────────────────────────────────────────────────┐     │
│   │ "You are a Goldfish reviewer subagent: strictly       │     │
│   │  read-only, zero prior conversation context..."       │     │
│   │ "First read your persona definition at                │     │
│   │  <pkg>/agents/zoom_out.md and adopt it fully."        │     │
│   │ "Then read the evaluation standard at ..." (if any)   │     │
│   │ "Mode: review|brainstorm. Target document: ...        │     │
│   │  [range: full file] [semantic target: ...]"           │     │
│   │ "Baseline reading list: ..."                          │     │
│   │ Report format: Severity / Scope / Description /       │     │
│   │ Rationale ... else exactly "No findings."             │     │
│   └───────────────────────────────────────────────────────┘     │
│                                                                 │
│   spawn("pi", ["--print","--no-session",                        │
│                "--tools","read,grep,find,ls", prompt])          │
│        cwd = workspace, stdout/stderr piped                     │
│        timeout EGM_GOLDFISH_TIMEOUT_MS (default 900000 ms)      │
│        on timeout/abort: SIGTERM → SIGKILL after 5s             │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ Consolidation (deterministic, no LLM) ─────────────────────────┐
│ tallySeverities(): regex-count "Severity: blocker|major|nit"    │
│   per reviewer + total (counted, not deduplicated)              │
│ buildReport(): write <artifactDir>/goldfish_review_report.md    │
│   (auto-numbered -2.md, -3.md if the name is taken), under the  │
│   package file-mutation queue                                   │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
Tool result to the model: ONLY the report path + a one-line summary
("…5 ok, 0 failed. Findings tally: 1 Blocker, 3 Major, 2 Nit")
plus per-reviewer tallies in `details` — artifact-first: full
findings are never returned in the tool result.
```

**Why this yields genuinely zero-context reviewers:** each child is a brand-new
Pi process with `--no-session`. Its only context is the composed prompt — it
has no stake in the document being good and no memory of the design
conversation. The persona file (e.g. `agents/zoom_out.md`, the "Skeptical
Architect" focused on YAGNI and simplicity) is read *by the child itself* as
its first action, so its identity comes from vendored markdown, not from any
harness agent registry.

Failure handling: a child that exits nonzero, times out, or is aborted is
encoded as `timeout`/`error` in the consolidated report (with a stderr tail);
the tool only throws when **all** reviewers failed, so one flaky child never
discards the others' findings.

## 5. Human gates (`egm_ask`)

```
Model: egm_ask { question: "Adopt router A or B?",
                 options: [{title:"Router A", description:"..."}, "Router B"] }
        │
        ▼
lib/ask-options.ts normalizeAskOptions()
  • accepts plain strings OR {title, description} objects (models
    routinely reach for the object shape popularized by ask tools)
  • strips "(Recommended)"-style markers — the EGM interaction
    invariant bans biased gates; enforcing at normalization makes it
    API-enforced instead of advisory
        │
        ├── TUI mode? ──► AskSelectDialog (pi-tui SelectList)
        │                   ↑/↓ or keys 1-9 select, Enter confirm,
        │                   Esc cancel → "User selected: <option>"
        │                   (cancel → instructs the model to ask in
        │                    plain chat)
        │
        └── headless (--print/RPC)? ──► instructive result text:
              "No interactive UI in this mode. Ask the user in plain
               chat and end your turn: <question> Options: 1) … 2) …"
```

## 6. `egm_bootstrap` (recursive README generation)

Unlike reviews, this pipeline **is** deterministic extension code
(`lib/bootstrap.ts`): everything the upstream SKILL.md expresses procedurally
(BFS discovery, pruning, partitioning, retries, verification) lives in
exported pure functions, while the model-driven scout work happens inside the
spawned workers.

```
egm_bootstrap { path: "src/", targetFilename: "README.md" }
        │
        ▼
1. discoverTree()      BFS level-by-level (no recursive glob);
                       skip .git/node_modules/…, honor .gitignore
                       and .egmignore (documented glob subset)
2. pruneTree()         bottom-up pruning (drop leaves without
                       production source, keep manifest files)
3. SAFETY GATE         pruned dirs > 15 && !approved ?
                       └─► return gate message; the model must ask
                           via egm_ask and re-call with approved:true
                           (or stop if declined)
4. partitionTree()     adaptive partitioning → worker scopes
5. runPool() parallel  one pi --print worker per partition with
   workers             WRITE tools: --tools read,grep,find,ls,write,edit
                       worker writes README.md files and returns a
                       JSON subtree index on stdout
6. validate JSON       extractJson() + validateSubtreeIndex();
                       exactly ONE retry on malformed output
                       (upstream fault tolerance); failed partitions
                       get placeholder entries
7. roll-up             deterministic intermediate blueprints
                       bottom-up, then the root compiler worker
                       merges everything
8. verifyContractFiles()  mandatory final verification pass
        │
        ▼
Report → bootstrap_report.md; result: report path, written-file
count, verification violations
```

Tool-symmetry with reviews: **Goldfish reviewers are read-only**
(`read,grep,find,ls`) while **bootstrap workers can write**
(`…,write,edit`) — mirrored by `goldfish.ts` vs `worker-run.ts`.

## 7. Durable pipeline state (`egm_state`)

Long multi-stage reviews must survive compaction, pause/resume, and branching:

```
set: pi.appendEntry("egm-state", value)
     └─ custom session entry: durable on disk, excluded from model context
get: walk ctx.sessionManager.getBranch() backwards,
     return the first entry with customType "egm-state"
     └─ branch-scoped: abandoned branches are alternative
        histories and are never read
```

State is compact JSON (preset, stage, line ranges, report paths, iteration
counts) saved at stage boundaries by the model, per the skill prose.

## 8. `/egm-*` commands (skill injection)

Each `/egm-*` command is a thin alias that injects a vendored skill as a
normal user turn:

```
User types: /egm-review design_draft.md uninterrupted
        │
        ▼
lib/commands.ts  registerSkillCommand()
        │
        ├─ read  skills/egm-review/SKILL.md
        ├─ stripFrontmatter()    ← removes the leading YAML --- block
        └─ buildCommandPayload() ← appends "\n---\nUser arguments: ..."
        │
        ▼
pi.sendUserMessage(payload)   ← starts a NORMAL user turn
        │
        ▼
The model now "is" the skill: it follows the upstream EGM protocol
(intake → stages → reports), calling egm_goldfish / egm_ask /
egm_state as the prose instructs.
```

There is no orchestration code for reviews, so behavior is identical in TUI,
RPC, JSON, and `--print` modes (no `ctx.ui` calls on the happy path). The
seven commands map one-to-one onto the vendored skill directories:
`egm-brainstorm`, `egm-draft`, `egm-review`, `egm-review-loop`, `egm-resolve`,
`egm-drift-report`, `egm-bootstrap`.

## 9. Artifact directory resolution

```
EGM_ARTIFACT_DIR env var
   └─ else "EGM artifact directory: <path>" line (case-insensitive key)
      in <workspace>/AGENTS.md, then <workspace>/CLAUDE.md
      └─ else the working directory
        │
        ▼  (created recursively if missing; relative → workspace root)
EGM_ARTIFACT_LAYOUT env var
   └─ else "EGM artifact layout: flat|structured" marker line
      └─ else structured (default)
        │
        ▼
structured: <artifact-dir>/egm/<feature-slug>/{concepts_brief,design_draft,*_report}.md
            <artifact-dir>/egm/bootstrap/bootstrap_report.md
flat:       <artifact-dir>/{concepts_brief,design_draft,*_report,bootstrap_report}.md
            (auto-numbered -2, -3… inside the report's own directory)
```

## 10. Environment knobs

| Variable | Default | Applies to |
| --- | --- | --- |
| `EGM_ARTIFACT_LAYOUT` | `structured` | Artifact arrangement (§9): `structured` or `flat`. |
| `EGM_ARTIFACT_DIR` | working directory | Artifact root directory (§9). |
| `EGM_GOLDFISH_TIMEOUT_MS` | `900000` | Per-reviewer child timeout (§4). |
| `EGM_GOLDFISH_MAX_CONCURRENT` | `3` | Max simultaneous reviewer children (§4). |
| `EGM_BOOTSTRAP_TIMEOUT_MS` | `900000` | Per-worker child timeout (§6). |
| `EGM_BOOTSTRAP_MAX_CONCURRENT` | `3` | Max simultaneous bootstrap workers (§6). |

Invalid values fall back to the defaults (clamped to ≥ 1).
