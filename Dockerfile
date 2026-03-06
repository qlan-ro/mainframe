# Stage 1: Build
FROM node:24-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable pnpm
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY packages/types/ packages/types/
COPY packages/core/ packages/core/
RUN pnpm --filter @qlan-ro/mainframe-types build && pnpm --filter @qlan-ro/mainframe-core build
RUN pnpm exec esbuild packages/core/dist/index.js --bundle --platform=node --target=node20 --format=cjs \
    --external:better-sqlite3 "--external:*.node" --log-override:empty-import-meta=silent \
    --outfile=daemon.cjs
RUN cd /tmp && npm init -y > /dev/null && npm install better-sqlite3 --ignore-scripts \
    && cp -r /app/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/build /tmp/node_modules/better-sqlite3/build

# Stage 2: Runtime
FROM node:24-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && ARCH=$(dpkg --print-architecture) \
    && curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}" \
       -o /usr/local/bin/cloudflared \
    && chmod +x /usr/local/bin/cloudflared \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/daemon.cjs ./daemon.cjs
COPY --from=build /tmp/node_modules/ ./node_modules/

RUN useradd -m mainframe
USER mainframe

ENV NODE_ENV=production
# Always log to stdout in containers (12-factor); LOG_LEVEL controls verbosity
ENV LOG_TO_STDOUT=true
EXPOSE 31415
VOLUME /home/mainframe/.mainframe

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:31415/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "daemon.cjs"]
