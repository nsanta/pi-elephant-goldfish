#!/usr/bin/env bash
# Sync EGM content from the upstream clone into this package, then apply the
# scripted pi adaptations. Fails (set -e + pattern checks in adapt-pi.mjs) when
# upstream drifts from the patterns we substitute.
#
# Usage: EGM_UPSTREAM=/path/to/clone ./scripts/sync-upstream.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="${EGM_UPSTREAM:-$(dirname "$ROOT")/elephant-goldfish-model}"

if [ ! -d "$UPSTREAM/skills" ]; then
  echo "error: upstream clone not found at $UPSTREAM" >&2
  echo "       clone it or set EGM_UPSTREAM=/path/to/elephant-goldfish-model" >&2
  exit 1
fi

echo "upstream: $UPSTREAM"

for dir in skills agents resources; do
  rm -rf "$ROOT/$dir"
  cp -R "$UPSTREAM/$dir" "$ROOT/$dir"
done

echo "vendored skills/, agents/, resources/"
node "$ROOT/scripts/adapt-pi.mjs"
