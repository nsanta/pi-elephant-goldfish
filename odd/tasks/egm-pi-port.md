# Feature: egm-pi-port — Elephant-Goldfish Model as a Pi Package

**Branch:** `feature/egm-pi-port`
**Plan:** `PLAN.md` (approved by user, "start")
**Upstream pin:** google/elephant-goldfish-model @ `a8380ab` (clone: `/home/nicolas/projects/elephant-goldfish-model`)
**Decisions (defaults from plan, user approved start):** standalone-first; name `pi-elephant-goldfish`; git-install distribution first (npm deferred to Phase 6); upstream PR after Phase 5.

## Tasks

### Phase 0 — Scaffold (done)
- [x] package.json with `pi` key, `pi-package` keyword, host peerDependencies
- [x] minimal `extensions/egm-core.ts` extension entry
- [x] `UPSTREAM.md` (pin + policy) and `scripts/sync-upstream.sh` + adapt-pi.mjs stub
- [x] .gitignore (node_modules, dist, .pi/)
- [x] Acceptance: `pi -e .` loads with no extension errors (verified: exit 0, reply OK, zero package warnings)
- **Evidence:** commit `1d1e9b0` feat: scaffold pi package skeleton (phase 0)

### Phase 1 — Vendor content + adaptation layer (done)
- [x] Vendor skills/ agents/ resources/ from upstream clone (7 skills/37 files, 9 agents, 7 resources)
- [x] scripts/adapt-pi.mjs: scripted substitutions applied — header 7/7, delegation 4/4 spawning skills, egm_ask rename 13, ../../ paths; drift-detecting (fails on missing anchors)
- [x] docs/pi.md harness guide (install, delegation mapping, artifact dir, support status)
- [x] checks: scripts/check-content.mjs — frontmatter 16/16 pass, link integrity 32 files with documented 2-entry allowlist (TESTING.md → Phase 5, docs/index.md → no equivalent)
- [x] Acceptance: sync exit 0; checks exit 0; package loads via `pi -e .`; extension command `/egm-version` RPC disposition=handled; skills registered `/skill:egm-*` (hidden from model auto-invocation by upstream `disable-model-invocation: true`)
- **Evidence:** delegated to gentle-ai-worker (task mvs2oleu-1-ngbr) + parent verification; commit `8f8cc23`
- **Verification:** independent verifier (gentle-ai-verify) PASS 6/6 — vendor fidelity (agents/resources byte-identical; skill diffs exclusively the 4 sanctioned classes; deterministic regeneration from pristine upstream), adaptation-script negative control (fails on corrupted anchor), checker negative controls (unlisted target fails; allowlist works), package integration (RPC handled, clean startup), content sanity, clean git state
- **Review disposition:** native review consent DECLINED by the user for this candidate (57 files, 3849 lines, medium risk); candidate-scoped per RDD; ASSESS fallback plan executed (writer self-verification + independent verifier PASS)

### Phase 2 — Core extension runtime (done)
- [x] egm_ask single-select gate tool (pi-tui SelectList, 1-9 keys, Esc cancel; plain-chat fallback verified in print mode)
- [x] egm_goldfish spawn tool (bounded-concurrency pool, `--no-session --tools read,grep,find,ls` children, SIGTERM→SIGKILL timeout escalation, abort wiring, deterministic severity tally, artifact-first report via withFileMutationQueue, instructive synthesizer/bootstrap rejections)
- [x] config: EGM_ARTIFACT_DIR env → AGENTS.md/CLAUDE.md `EGM artifact directory:` marker → working dir; EGM_GOLDFISH_TIMEOUT_MS (900s) / EGM_GOLDFISH_MAX_CONCURRENT (3), clamped
- [x] Acceptance: real zoom_out reviewer spawned on fixture caught all 4 planted flaws (1-2 Blocker, Major, Nit tallies); collision naming (-2 suffix); artifact dir env + AGENTS.md marker verified; all-failed path verified by code read
- [x] Verification: independent verifier 6/7 PASS + 1 dispositioned (single-reviewer all-timeout writes no report — matches approved spec "all failed → throw"; my test instruction contradicted the spec, not the code). ASSESS risk high (process boundary) honored via independent verifier
- **Review disposition:** native review consent DECLINED by the user for this candidate (5 files, 851 lines, high risk: process spawning); candidate-scoped
- **Evidence:** delegated to gentle-ai-worker + independent gentle-ai-verify; commit `490468a`

### Phase 3 — Orchestration layer (done)
- [x] Seven `/egm-*` commands: load vendored SKILL.md (frontmatter stripped), start a user turn with body + args; identical in all modes; verified handled + model executes skill intake
- [x] `egm_state` tool: branch-aware pipeline state via appendEntry custom entries (compaction/branch safe); roundtrip verified
- [x] Fixture `sample-design-full.md`: exact `## Detailed Implementation Plan` at line 88 (split 1-87/88-137), four planted flaw classes verified present
- [x] Acceptance: headless `/egm-review <fixture> uninterrupted` ran all five stages via 9 goldfish children, 0 failures, 78 raw findings → consolidated report with stage tally table + verdict catching every planted flaw class
- [x] Verification: independent verifier 6/6 PASS (pure-function tests for frontmatter/payload, host-type conformance of appendEntry/getBranch, live smokes, docs, type check with only the known host-import error class)
- **Review disposition (standing, user decision):** intermediate phase candidates (Phases 3-5) are explicitly LEFT UNREVIEWED by the user (choice recorded after 2 declines + 2 expired consent prompts); only the Phase 6 release candidate gets the review offer. ASSESS unknown-outcome path honored via independent verifier
- **Evidence:** writer task (timed out post-fixture; artifacts + code recovered and parent-verified) + independent gentle-ai-verify 6/6; commit `079545f`

### Phase 4 — Bootstrap swarm & drift wiring (done)
- [x] `egm_bootstrap` tool: discovery (level-BFS + documented .gitignore subset), pruning, adaptive partitioning, >15-dir gate (returns approval request; model mediates via egm_ask), parallel read-write workers (inline scout steps per upstream fallback), JSON validation + retry + placeholders, deterministic intermediate blueprints, root-compiler child, mandatory verification pass, bootstrap_report.md
- [x] worker-run.ts: read-write child runner (`--tools read,grep,find,ls,write,edit`), kill/abort parity with goldfish.ts
- [x] Skill re-adaptation: bootstrap delegation now points at egm_bootstrap; sync idempotence proven (all 7 dirs == adapt-pi(upstream))
- [x] Acceptance: full pipeline on 6-dir fixture — 10 contract files, 4/4 workers ok, root ok, 0 verification violations, `npm test` detected; gate fired on 16-dir tree (no workers spawned); correction policy preserved KEEP-ME-NOTES (writer run #1); pure functions unit-tested (2 real bugs caught)
- [x] Verification: independent verifier 5/6 PASS + 1 dispositioned (my instruction wording error re: "byte-identical" — idempotence proof shows zero drift)
- [x] Drift report: no runtime needed (in-thread skill) — confirmed adapted and discoverable
- **Review disposition:** standing user decision — intermediates unreviewed
- **Evidence:** writer task + independent gentle-ai-verify + parent-run full pipeline (2 runs); commit `bbb2b7e`

### Phase 5 — Tests, docs, harness record (done)
- [x] vitest suite: 74 unit tests (frontmatter, 24KB skill-load cap mirrored from upstream, scenario coverage, adaptation invariants, real-script sync fidelity, extension-lib pure functions, manifest hygiene); integration suite EGM_E2E-gated
- [x] Integration live-fired by parent: 3/3 PASS (RPC smokes + real zoom_out reviewer); fixed assistant-text capture (message_end, not start/update) + waitFor mode in RPC helper
- [x] vitest.config.ts host-alias discovery (pi binary → realpath → node_modules walk-up); devDeps vitest+typescript only, host packages excluded
- [x] TESTING.md: playbook + harness record (phases 0-4 evidence with dates/commits); allowlist entry removed from check-content (links now resolve)
- [x] docs/pi.md finalized: support status, testing section, known limits
- [x] Upstream-bar status: review end-to-end verified headless (Phase 3/4 evidence); brainstorm/draft workflow-start verified via RPC; full interactive multi-turn flows remain manual per TESTING.md
- **Review disposition:** standing user decision — intermediates unreviewed
- **Evidence:** writer task (74/74 unit) + parent live integration run + one test fix; commit `292b893`

### Phase 6 — Release & upstream contribution (done — release actions handed to user)
- [x] README.md (features/install/quickstart/config/dev; install URL marked TBD-OWNER)
- [x] docs/upstream-pr.md — contribution options A/B per upstream policy, ready-to-paste artifacts, submission checklist (submission is user's call)
- [x] Install-path smoke: `pi install -l ./` → `/egm-version` handled via installed declaration (with one-run `--approve`; project trust is interactive TUI, user-granted)
- [x] check-content scans README.md now; 74 unit + content checks green
- [x] LICENSE: canonical Apache-2.0 text fetched from apache.org and integrity-verified
- [x] Release QA (independent verifier): 7/7 PASS, no release-blocking failures — sync idempotence over pristine upstream, secrets/placeholder scan, shell + process-boundary review, branch completeness (17 commits), regressions
- [x] Release candidate review offer made; user DECLINED via host UI (109 files, 11,933 lines, high risk) — candidate-scoped; ASSESS high-risk path honored via release QA verifier
- [ ] **User actions pending:** set GitHub owner (package.json + README TBD-OWNER), create/push remote, tag v0.1.0, npm publish (optional), upstream PR submission (optional, draft ready in docs/upstream-pr.md)
- **Evidence:** commits `3904a10`, `46148d5`, `6d96560`, `e6e7936`; writer tasks + release QA verifier
