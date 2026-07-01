#!/usr/bin/env bash
# Vendor the chat_engine source into the repo so the server builds with zero
# external paths (needed for `docker build`, CI, and `git clone && run`).
#
# chat_engine is developed in its own repo; we keep a *copy* under
# apps/server/vendor/chat_engine and point mix.exs at it. Re-run this whenever
# the upstream engine changes. Provenance is recorded in vendor/chat_engine/VENDOR.txt.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ENGINE_SRC:-$REPO_ROOT/../../db/engine}"
DEST="$REPO_ROOT/apps/server/vendor/chat_engine"

if [ ! -f "$SRC/mix.exs" ]; then
  echo "error: engine source not found at $SRC (set ENGINE_SRC=/path/to/engine)" >&2
  exit 1
fi

echo "vendoring chat_engine from $SRC → $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
# Only the files the engine's own mix package ships — no _build/deps/.git/cover.
for item in lib config mix.exs README.md CHANGELOG.md LICENSE .formatter.exs; do
  [ -e "$SRC/$item" ] && cp -R "$SRC/$item" "$DEST/$item"
done

rev="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown)"
cat > "$DEST/VENDOR.txt" <<EOF
Vendored copy of chat_engine — DO NOT edit here.
Source: $SRC
Upstream rev: $rev
Re-sync with: scripts/vendor-engine.sh
EOF

echo "done (upstream rev: $rev)"
