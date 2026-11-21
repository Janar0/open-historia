#!/bin/sh
set -eu

DATA_DIR="${OH_DATA_DIR:-/data}"
STOCK_SOURCE="/app/stock/regions.geojson"
LEGACY_DATA_DIR="${OH_LEGACY_DATA_DIR:-/legacy-data}"

mkdir -p "$DATA_DIR"

# The compose file uses a visible host directory. If that directory is empty
# and the old named volume contains data, migrate it once. Existing data is
# never overwritten by an image update. A fresh directory needs nothing here:
# the server seeds the built-in scenario itself (server/seed).
if [ ! -f "$DATA_DIR/scenario-manifest.json" ] \
  && [ -z "$(find "$DATA_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ] \
  && [ -f "$LEGACY_DATA_DIR/scenario-manifest.json" ]; then
  cp -a "$LEGACY_DATA_DIR"/. "$DATA_DIR"/
fi

# The stock world every scenario without a map of its own is drawn on lives in
# the data directory. The image carries the checksum-verified copy; lay it in
# when the directory has none or holds an older edition.
if [ -f "$STOCK_SOURCE" ]; then
  mkdir -p "$DATA_DIR/stock"
  if ! cmp -s "$STOCK_SOURCE" "$DATA_DIR/stock/regions.geojson"; then
    cp "$STOCK_SOURCE" "$DATA_DIR/stock/regions.geojson"
  fi
fi

exec node /app/server/server.js "$@"
