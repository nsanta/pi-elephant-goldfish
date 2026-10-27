# Upstream

This package ports the **Elephant-Goldfish Model (EGM)** plugin to the
[Pi coding agent](https://github.com/earendil-works/pi-coding-agent).

- **Upstream:** https://github.com/google/elephant-goldfish-model
- **Pinned revision:** `a8380ab` (2026, Apache-2.0)
- **Upstream policy:** all harnesses share one content set — *"No harness gets a
  fork of the skill text."* Differences live in manifests + delegation docs.

## What is vendored

| Path here | Vendored from upstream | Modifications |
|---|---|---|
| `skills/` | `skills/` | Scripted, minimal substitutions only (see `scripts/adapt-pi.mjs`) |
| `agents/` | `agents/` | None |
| `resources/` | `resources/` | None |
| `docs/pi.md` | — (new) | Pi harness documentation |

## Syncing from upstream

```sh
# EGM_UPSTREAM points at a local clone (default: ../elephant-goldfish-model)
./scripts/sync-upstream.sh
```

The script copies content, applies the scripted pi adaptations, and fails if an
expected upstream pattern disappears (drift detection). Never hand-edit vendored
files; change the adaptation script instead, then re-run sync.

## License

Upstream EGM is Apache-2.0 (Google, not an officially supported Google product).
This port inherits Apache-2.0 for vendored content and the port code.
