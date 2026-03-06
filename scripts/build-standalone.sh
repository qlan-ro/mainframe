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
node packages/desktop/scripts/bundle-daemon.mjs "${DIST_DIR}/lib/daemon.cjs"

# 2. Copy better-sqlite3 prebuild for target platform
PREBUILD_DIR="node_modules/better-sqlite3/prebuilds/${OS}-${ARCH}"
if [ ! -d "$PREBUILD_DIR" ]; then
  echo "No prebuild found at ${PREBUILD_DIR}" >&2
  exit 1
fi
mkdir -p "${DIST_DIR}/lib/prebuilds/${OS}-${ARCH}"
cp -r "${PREBUILD_DIR}/." "${DIST_DIR}/lib/prebuilds/${OS}-${ARCH}/"

# 3. Download Node.js binary for target platform
NODE_ARCH="$ARCH"

NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${OS}-${NODE_ARCH}.tar.gz"
echo "Downloading Node.js ${NODE_VERSION} for ${OS}-${NODE_ARCH}..."
curl -fsSL "$NODE_URL" | tar -xz --strip-components=1 -C "${DIST_DIR}" "*/bin/node"

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

# 5. Create wrapper script
cat > "${DIST_DIR}/bin/mainframe-daemon" << 'WRAPPER'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
export PATH="${SCRIPT_DIR}:${PATH}"
exec "${SCRIPT_DIR}/node" "${BASE_DIR}/lib/daemon.cjs" "$@"
WRAPPER
chmod +x "${DIST_DIR}/bin/mainframe-daemon"

# 6. Package
tar -czf "dist-standalone/${DIST_NAME}.tar.gz" -C dist-standalone "$DIST_NAME"
echo "Built: dist-standalone/${DIST_NAME}.tar.gz"
