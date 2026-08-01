#!/bin/sh
set -eu

DATA_DIR="${OH_DATA_DIR:-/data}"
SEED_DIR="/app/server/data"
LEGACY_DATA_DIR="${OH_LEGACY_DATA_DIR:-/legacy-data}"

mkdir -p "$DATA_DIR"

# The compose file now uses a visible host directory. If that directory is
# empty and the old named volume contains data, migrate it before falling back
# to the built-in seed. Existing data is never overwritten by an image update.
if [ "$DATA_DIR" != "$SEED_DIR" ] && [ ! -f "$DATA_DIR/scenario-manifest.json" ]; then
  if [ -z "$(find "$DATA_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ] \
    && [ -f "$LEGACY_DATA_DIR/scenario-manifest.json" ]; then
    cp -a "$LEGACY_DATA_DIR"/. "$DATA_DIR"/
  elif [ -z "$(find "$DATA_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ] \
    && [ -d "$SEED_DIR/scenarios/default" ]; then
    cp -a "$SEED_DIR"/. "$DATA_DIR"/
  fi
fi

exec node /app/server/server.js "$@"
