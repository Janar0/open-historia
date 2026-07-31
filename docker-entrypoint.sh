#!/bin/sh
set -eu

DATA_DIR="${OH_DATA_DIR:-/data}"
SEED_DIR="/app/server/data"

mkdir -p "$DATA_DIR"

# Docker mounts the persistent volume over the writable data directory. Seed it
# once from the image's built-in scenario, without overwriting an existing
# server or campaign on subsequent container recreations.
if [ "$DATA_DIR" != "$SEED_DIR" ] \
  && [ ! -f "$DATA_DIR/scenario-manifest.json" ] \
  && [ -d "$SEED_DIR/scenarios/default" ]; then
  cp -a "$SEED_DIR"/. "$DATA_DIR"/
fi

exec node /app/server/server.js "$@"
