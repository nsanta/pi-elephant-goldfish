# AGENTS.md

## Artifact generation (artifact-forge)

- When asked for a dashboard, report, diagram, visual explainer, or interactive tool, **delegate generation to the `artifact-forge` subagent** (pass the task and this directory as cwd). Do not build artifacts inline — the design system is bulky and stays out of the main session's context.
- Small tweaks to an existing artifact (add a chart, switch a value, change wording): edit the HTML in place; no subagent needed.
- `artifacts/_template.html` is the versioned design contract — **never overwrite it**. Generated artifacts under `artifacts/*.html` are versioned review records (deliberately not gitignored).
- Markdown is the source of truth; HTML artifacts are human-facing projections. Plan changes go into the markdown first, then the artifact is regenerated — never the reverse.
- Defaults: `dusk` palette, light mode. Override per artifact via prompt (e.g. "use the nordic palette").
