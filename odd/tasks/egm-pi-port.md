# Feature: egm-pi-port — Elephant-Goldfish Model as a Pi Package

**Branch:** `feature/egm-pi-port`
**Plan:** `PLAN.md` (approved by user, "start")
**Upstream pin:** google/elephant-goldfish-model @ `a8380ab` (clone: `/home/nicolas/projects/elephant-goldfish-model`)
**Decisions (defaults from plan, user approved start):** standalone-first; name `pi-elephant-goldfish`; git-install distribution first (npm deferred to Phase 6); upstream PR after Phase 5.

## Tasks

### Phase 0 — Scaffold (in progress)
- [ ] package.json with `pi` key, `pi-package` keyword, host peerDependencies
- [ ] minimal `extensions/egm-core.ts` extension entry
- [ ] `UPSTREAM.md` (pin + policy) and `scripts/sync-upstream.sh`
- [ ] .gitignore node_modules
- [ ] Acceptance: `pi -e .` loads with no extension errors
- **Evidence:** (pending)

### Phase 1 — Vendor content + adaptation layer
- [ ] Vendor skills/ agents/ resources/ from upstream clone
- [ ] scripts/adapt-pi.mjs: scripted substitutions (delegation paragraph, harness doc header, ask_question → egm_ask), drift-detecting (fails if pattern missing)
- [ ] docs/pi.md harness placeholder
- [ ] checks: frontmatter validity + link integrity (scripts/check-content.mjs)
- [ ] Acceptance: all 7 skills discoverable, checks green
- **Evidence:** (pending)

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
