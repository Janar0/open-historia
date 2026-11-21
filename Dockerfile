# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Map binaries are release assets rather than Git files. Put the exact,
# checksum-verified versions into the image so a fresh server is immediately
# playable instead of relying on a second bootstrap command. The stock world
# (server/data/stock/regions.geojson) is fetched here too and handed to the
# data directory by the entrypoint.
RUN node scripts/fetch-map-assets.mjs \
  && node --input-type=module -e 'import fs from "node:fs"; const manifest = JSON.parse(fs.readFileSync("scripts/map-assets.json", "utf8")); const missing = manifest.assets.filter(({ path, bytes }) => { try { return fs.statSync(path).size !== bytes; } catch { return true; } }); if (missing.length) { console.error("Missing or incomplete map assets:", missing.map(({ path }) => path).join(", ")); process.exit(1); }' \
  && mkdir -p /app/stock && mv server/data/stock/regions.geojson /app/stock/regions.geojson

RUN npm run build

# The server resolves stock PMTiles through public/assets and streams them via
# /api/runtime/pmtiles. Vite also copies public/ into dist/, so remove the
# duplicate archives from the static bundle to keep the final image smaller.
RUN rm -f dist/assets/*.pmtiles dist/assets/regions-seed.geojson dist/assets/cities-seed.json \
  && find server -name "*.test.js" -delete

FROM node:22-bookworm-slim AS runtime

# OH_REQUIRE_AUTH: a hosted server never comes up open. It refuses to start
# until a shared API key is configured (server/auth.js).
ENV NODE_ENV=production \
    PORT=3000 \
    OH_HOST=0.0.0.0 \
    OH_DATA_DIR=/data \
    OH_REQUIRE_AUTH=1

# Owned by the unprivileged user from the start: a recursive chown afterwards
# would copy every file into a second layer.
COPY docker-entrypoint.sh /usr/local/bin/open-historia-entrypoint
RUN chmod 755 /usr/local/bin/open-historia-entrypoint \
  && mkdir -p /app /data && chown node:node /app /data
WORKDIR /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/public ./public
COPY --chown=node:node --from=build /app/server ./server
COPY --chown=node:node --from=build /app/stock ./stock
COPY --chown=node:node --from=build /app/scripts/map-assets.json /app/scripts/fetch-map-assets.mjs ./scripts/

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/auth/status').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["open-historia-entrypoint"]
