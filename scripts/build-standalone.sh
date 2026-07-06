#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/build-standalone.sh <os> <arch>
# Example: ./scripts/build-standalone.sh darwin arm64

OS="${1:?Usage: build-standalone.sh <os> <arch>}"
ARCH="${2:?Usage: build-standalone.sh <os> <arch>}"
NODE_VERSION="24.0.0"

DIST_NAME="mainframe-daemon-${OS}-${ARCH}"
DIST_DIR="dist-standalone/${DIST_NAME}"

echo "Building ${DIST_NAME}..."

rm -rf "$DIST_DIR"
mkdir -p "${DIST_DIR}/bin" "${DIST_DIR}/lib"

# 1. Bundle daemon
pnpm --filter @qlan-ro/mainframe-types build
pnpm --filter @qlan-ro/mainframe-core build
node packages/app-electron/scripts/bundle-daemon.mjs "${DIST_DIR}/lib/daemon.cjs"

# 2. Collect the daemon's external runtime packages into a node_modules SIBLING of
#    daemon.cjs. The daemon is esbuilt with these left external (better-sqlite3 +
#    its native binary, the LSP servers, ripgrep), so each stays a runtime require()
#    that Node resolves from node_modules next to daemon.cjs. Same collector backs
#    the Tauri sidecar bundler. Copying the whole better-sqlite3 package brings its
#    per-platform prebuild along (the CI runner installed it for this target).
node scripts/collect-daemon-deps.mjs \
  packages/core/package.json \
  "${DIST_DIR}/lib/node_modules" \
  better-sqlite3 typescript-language-server pyright @vscode/ripgrep

SQLITE_DEST="${DIST_DIR}/lib/node_modules/better-sqlite3"
if [ ! -f "${SQLITE_DEST}/package.json" ]; then
  echo "better-sqlite3 was not collected into the bundle" >&2
  exit 1
fi
# The JS package resolving is not enough — the daemon crashes at runtime without the
# compiled native addon. `pnpm install` on this CI runner must have built/fetched it.
if [ -z "$(find "$SQLITE_DEST" -name '*.node' -print -quit)" ]; then
  echo "No better-sqlite3 native binary (*.node) in ${SQLITE_DEST}" >&2
  exit 1
fi

# 3. Download Node.js binary for target platform
NODE_ARCH="$ARCH"

NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${OS}-${NODE_ARCH}.tar.gz"
NODE_PREFIX="node-v${NODE_VERSION}-${OS}-${NODE_ARCH}"
echo "Downloading Node.js ${NODE_VERSION} for ${OS}-${NODE_ARCH}..."
curl -fsSL "$NODE_URL" | tar -xz -C "${DIST_DIR}/bin/" --strip-components=2 "${NODE_PREFIX}/bin/node"

# 4. Download cloudflared for target platform
if [ "$OS" = "darwin" ]; then
  CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${OS}-${ARCH}.tgz"
  curl -fsSL "$CF_URL" | tar -xz -C "${DIST_DIR}/bin/"
else
  CF_ARCH="$ARCH"
  if [ "$ARCH" = "x64" ]; then CF_ARCH="amd64"; fi
  CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}"
  curl -fsSL "$CF_URL" -o "${DIST_DIR}/bin/cloudflared"
fi
chmod +x "${DIST_DIR}/bin/cloudflared"

# 5. Create wrapper script.
# MAINFRAME_STANDALONE_ROOT tells `mainframe update` where the install lives so it
# can extract a new release over it.
cat > "${DIST_DIR}/bin/mainframe" << 'WRAPPER'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
export MAINFRAME_ORIG_PATH="${PATH}"
export MAINFRAME_STANDALONE_ROOT="${BASE_DIR}"
export PATH="${SCRIPT_DIR}:${PATH}"
exec "${SCRIPT_DIR}/node" "${BASE_DIR}/lib/daemon.cjs" "$@"
WRAPPER
chmod +x "${DIST_DIR}/bin/mainframe"

# Back-compat alias: existing systemd units / PATHs reference `mainframe-daemon`.
ln -sf mainframe "${DIST_DIR}/bin/mainframe-daemon"

# 6. Package
tar -czf "dist-standalone/${DIST_NAME}.tar.gz" -C dist-standalone "$DIST_NAME"
echo "Built: dist-standalone/${DIST_NAME}.tar.gz"
