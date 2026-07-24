#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/build-standalone.sh <os> <arch>
# Example: ./scripts/build-standalone.sh darwin arm64
#
# Builds the Rust daemon natively for the host (cargo doesn't cross-compile
# here), so <os>/<arch> must match the machine this runs on — CI enforces that
# by running one job per platform in the release matrix.

OS="${1:?Usage: build-standalone.sh <os> <arch>}"
ARCH="${2:?Usage: build-standalone.sh <os> <arch>}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_NAME="mainframe-daemon-${OS}-${ARCH}"
DIST_DIR="dist-standalone/${DIST_NAME}"

echo "Building ${DIST_NAME}..."

rm -rf "$DIST_DIR"
mkdir -p "${DIST_DIR}/bin"

# 1. Build the Rust daemon (release profile) and stage it as bin/mainframe-daemon.
cargo build --release -p mainframe-daemon --manifest-path "${ROOT}/packages/core-rs/Cargo.toml"
cp "${ROOT}/packages/core-rs/target/release/mainframe-daemon" "${DIST_DIR}/bin/mainframe-daemon"
chmod +x "${DIST_DIR}/bin/mainframe-daemon"

# 2. Download cloudflared for target platform.
CF_ARCH="$ARCH"
if [ "$ARCH" = "x64" ]; then CF_ARCH="amd64"; fi

if [ "$OS" = "darwin" ]; then
  CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${OS}-${CF_ARCH}.tgz"
  curl -fsSL "$CF_URL" | tar -xz -C "${DIST_DIR}/bin/"
else
  CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}"
  curl -fsSL "$CF_URL" -o "${DIST_DIR}/bin/cloudflared"
fi
chmod +x "${DIST_DIR}/bin/cloudflared"

# 3. Create the `mainframe` wrapper. It execs the real binary directly (no
# symlink), matching install.sh's chmod list which expects both files present.
# MAINFRAME_STANDALONE_ROOT tells `mainframe update` where the install lives so
# it can extract a new release over it.
cat > "${DIST_DIR}/bin/mainframe" << 'WRAPPER'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
export MAINFRAME_ORIG_PATH="${PATH}"
export MAINFRAME_STANDALONE_ROOT="${BASE_DIR}"
export PATH="${SCRIPT_DIR}:${PATH}"
exec "${SCRIPT_DIR}/mainframe-daemon" "$@"
WRAPPER
chmod +x "${DIST_DIR}/bin/mainframe"

# 4. Package.
tar -czf "dist-standalone/${DIST_NAME}.tar.gz" -C dist-standalone "$DIST_NAME"
echo "Built: dist-standalone/${DIST_NAME}.tar.gz"
