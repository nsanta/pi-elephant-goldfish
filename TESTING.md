# EGM Testing Playbook (Pi port)

This document is the developer playbook for the pi-elephant-goldfish test suite:
what to run, what each tier proves, and the recorded harness verification
evidence for the Pi port. The vendored `skills/*/TEST.md` files link here for
the general testing entry points; the per-skill protocol checklists in those
files remain the authority for interactive skill evaluation.

## What to run

### Unit and integration tests (vitest)

```bash
# Everything local: unit tests run offline and deterministically; the
# integration tests are skipped unless EGM_E2E is set.
npm test

# Unit tests only
npm run test:unit
```

Unit tests are fully local, fast (<1s), and deterministic. They port the intent
and thresholds of the upstream unit suite to this package: frontmatter schema
(`tests/unit/content.test.ts`), the 24,000-byte Antigravity skill body limit,
persona/standard scenario coverage and inventory parity with the upstream
clone, vendored-content adaptation invariants and `adapt-pi.mjs` sync fidelity
(`tests/unit/adaptation.test.ts`), the extension library's pure functions
(`tests/unit/extensions-lib.test.ts`), and the package manifest
(`tests/unit/manifest.test.ts`).

Host package note: the extension modules value-import the installed pi runtime
packages (`typebox`, `@earendil-works/pi-coding-agent`,
`@earendil-works/pi-tui`). The vitest config locates the local pi installation
(env `PI_PKG_DIR` if set, else the `pi` binary on PATH) and aliases those
imports to it; the affected suites skip themselves off if discovery fails.
This package never vendors the host packages (see `package.json`
peerDependencies).

### Content checks

```bash
npm run check:content
```

Frontmatter validation over every `skills/*/SKILL.md` and `agents/*.md`, and
relative-link integrity over all markdown under `skills/`, `agents/`,
`resources/`, and `docs/` (a port of upstream `test_link_integrity.py`).

### Env-gated end-to-end (uses model quota)

The integration tests spawn the real `pi` CLI against this package's dev
install (`pi -e .`) and are **skipped by default** because they consume your
account's model quota and take wall time:

```bash
# RPC smokes: /egm-version disposition, /egm-review no-args workflow start
EGM_E2E=1 npx vitest run tests/integration/smoke.test.ts

# One real zero-context zoom_out reviewer over the sample-design fixture
EGM_E2E=1 npx vitest run tests/integration/goldfish.test.ts
```

## Harness test record (pi via `pi -e .` dev install)

All evidence below was gathered with the package loaded as a dev install
(`pi -e .`) on this repository, on the dates listed. PASS means the acceptance
criterion for that phase was observed directly (command output, spawned child
behavior, or written artifact).

| Phase | Scope verified | Evidence | Date | Status |
| --- | --- | --- | --- | --- |
| 0 — Scaffold | `pi -e .` loads the extension with zero package errors; `/egm-version` RPC disposition `handled`; skills registered as `/skill:egm-*` and hidden from model auto-invocation | phase acceptance run; commit `1d1e9b0` | 2026-10-27 | PASS |
| 1 — Vendoring + adaptation | agents/ and resources/ byte-identical to upstream; skill diffs exclusively the 4 sanctioned adaptation classes; deterministic regeneration from pristine upstream; checker negative controls (unlisted broken target fails, allowlist works) | independent verifier 6/6 PASS; commit `8f8cc23` | 2026-10-28 | PASS |
| 2 — Core runtime (`egm_ask`, `egm_goldfish`) | real zoom_out reviewer spawned over the fixture caught all 4 planted flaws (1-2 Blocker, Major, Nit tallies); collision naming (`-2` suffix); artifact dir via `EGM_ARTIFACT_DIR` and `AGENTS.md` marker; bounded concurrency + SIGTERM→SIGKILL timeout escalation | independent verifier 6/7 PASS + 1 dispositioned; commit `490468a` | 2026-10-28 | PASS |
| 3 — Orchestration (`/egm-*`, `egm_state`) | seven `/egm-*` commands load the vendored skill body (frontmatter stripped) and start a user turn; headless `/egm-review <fixture> uninterrupted` ran all five stages via 9 goldfish children, 78 raw findings → consolidated report with stage tally table + verdict catching every planted flaw class | independent verifier 6/6 PASS; commit `079545f` | 2026-10-28 | PASS |
| 4 — Bootstrap swarm | full pipeline on the 6-dir fixture: 10 contract files, 4/4 workers ok, root roll-up ok, 0 verification violations; >15-dir safety gate fired on the 16-dir tree with no workers spawned; pure-function unit tests caught 2 real bugs pre-integration | independent verifier 5/6 PASS + 1 dispositioned; commit `bbb2b7e` | 2026-10-28 | PASS |

### Skill-load and workflow-start verification

- **Brainstorm / draft / review skill loading:** each `/egm-<name>` command was
  exercised in RPC mode; disposition `handled` and the model received the
  vendored skill body with frontmatter stripped and began the skill's intake
  (phase 1 and phase 3 evidence above). The automated equivalents live in
  `tests/integration/smoke.test.ts` (`EGM_E2E=1`).
- **Workflow start:** `/egm-review` with no arguments starts the review skill,
  and the first assistant turn asks for the target document (phase 3; automated
  in the RPC smoke).

## Known limits

- **Interactive gates need a TUI.** `egm_ask` renders a SelectList dialog in
  the TUI; in RPC/print mode it falls back to plain chat. The automated tests
  never exercise the interactive dialog path.
- **Full interactive flows are manual.** The multi-turn interactive brainstorm →
  draft → review conversations (including gates mid-flow) are verified manually
  against the per-skill checklists in `skills/*/TEST.md`, not by this suite.
- **Git-install smoke is deferred to release.** All recorded evidence uses the
  dev install (`pi -e .`). The `pi install git:...` path is exercised in the
  Phase 6 release checklist.

## Verification limits

Fresh-context (Goldfish) reviews were verified headless: spawned
`pi --print` children with no conversation history produced real reviewer
findings over fixture documents. The TUI dialog path is type-checked against
the host API, and the SelectList component used by `egm_ask` is pi's own
`@earendil-works/pi-tui` SelectList (same component pi's TUI renders), so
rendering parity is inherited from the host rather than re-tested here.

## Release record

- 2026-10-29 — v0.1.0 released: master fast-forwarded from feature/egm-pi-port (17+2 commits), tagged `v0.1.0`, pushed to https://github.com/nsanta/pi-elephant-goldfish (public).
- Git-install smoke (published path): `pi install --approve -l git:github.com/nsanta/pi-elephant-goldfish@v0.1.0` → installed; bare `pi --approve --mode rpc` `/egm-version` → notify `pi-elephant-goldfish 0.1.0` + disposition `handled`. Install removed after validation.
- Deferred: npm publish (registry not authenticated); upstream PR submission (draft in docs/upstream-pr.md).
