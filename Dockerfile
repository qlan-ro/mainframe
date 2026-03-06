# Stage 1: Build
FROM node:24-slim AS build
RUN corepack enable pnpm
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/types/package.json packages/types/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY packages/types/ packages/types/
COPY packages/core/ packages/core/
COPY packages/desktop/scripts/bundle-daemon.mjs packages/desktop/scripts/
RUN pnpm --filter @mainframe/types build && pnpm --filter @mainframe/core build
RUN node packages/desktop/scripts/bundle-daemon.mjs

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
COPY --from=build /app/packages/desktop/resources/daemon.cjs ./daemon.cjs
COPY --from=build /app/node_modules/better-sqlite3/prebuilds/ ./prebuilds/

RUN useradd -m mainframe
USER mainframe

ENV NODE_ENV=production
EXPOSE 31415
VOLUME /home/mainframe/.mainframe

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:31415/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "daemon.cjs"]
