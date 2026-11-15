# syntax=docker/dockerfile:1
# Build on your machine (not on the 1 GB server):
#   docker buildx build --platform linux/amd64 -t school-admin-bot:latest --load .

FROM node:22-bookworm-slim AS deps
# Toolchain only in case better-sqlite3 has no prebuilt binary for this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/

FROM deps AS build
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY web web
RUN npm run build

FROM deps AS prod-deps
RUN npm ci --omit=dev --workspace server --workspace shared \
  && npm cache clean --force

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/school.db \
    BACKUP_DIR=/app/data/backups \
    NODE_OPTIONS=--max-old-space-size=192
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY package.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY shared/src shared/src
COPY server/package.json server/tsconfig.json server/
COPY server/src server/src
COPY --from=build /app/web/dist web/dist
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# tsx directly (no npm wrapper process) to save memory.
CMD ["node_modules/.bin/tsx", "server/src/index.ts"]
