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
- **Evidence:** delegated to gentle-ai-worker (task mvs2oleu-1-ngbr) + parent verification; commit recorded below

### Phase 2 — Core extension runtime
- [ ] egm_ask single-select gate tool (ctx.ui.custom, invariants, non-UI fallback)
- [ ] egm_goldfish spawn tool (headless pool, timeouts, abort, report write)
- [ ] config: artifact dir, model/timeouts
- [ ] Acceptance: fixture spawns one real reviewer on a sample doc
- **Evidence:** (pending)

### Phase 3 — Orchestration layer
- [ ] /egm-* commands; review presets; semantic split; 5-stage pipeline; checkpoint gates; 1-audit cap; pause/resume (appendEntry)
- [ ] Acceptance: headless end-to-end /egm-review produces 5 reports + consolidated report
- **Evidence:** (pending)

### Phase 4 — Bootstrap swarm & drift wiring
- [ ] BFS discovery, pruning, >15-dir gate, adaptive partitioning, parallel workers, schema validation, roll-up, final verification pass
- [ ] Acceptance: 6-dir fixture OK; gate fires on 16-dir
- **Evidence:** (pending)

### Phase 5 — Tests, docs, harness record
- [ ] vitest unit + integration; ports of upstream checks
- [ ] docs/ install, delegation mapping, limits
- [ ] Acceptance: brainstorm→draft→review end-to-end via package install
- **Evidence:** (pending)

### Phase 6 — Release & upstream contribution
- [ ] tag/publish; README; upstream PR material (user decides submission)
- **Evidence:** (pending)
