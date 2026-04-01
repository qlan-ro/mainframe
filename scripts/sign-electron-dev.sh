#!/bin/bash
# Ad-hoc sign the dev Electron.app so macOS notification center works.
# Run after `pnpm install` or when notifications stop working.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENTITLEMENTS="$SCRIPT_DIR/dev-entitlements.plist"

# Resolve the real Electron.app path (pnpm may symlink)
ELECTRON_APP="$(readlink -f "$REPO_ROOT/node_modules/electron/dist/Electron.app")"

if [ ! -d "$ELECTRON_APP" ]; then
  echo "Electron.app not found at $ELECTRON_APP"
  exit 1
fi

echo "Signing inner frameworks..."
# Sign all inner frameworks/helpers first
find "$ELECTRON_APP/Contents/Frameworks" -depth -name "*.framework" -o -name "*.app" | while read -r component; do
  codesign --force --sign - --entitlements "$ENTITLEMENTS" "$component" 2>/dev/null || true
done

# Sign any remaining Mach-O binaries inside Frameworks
find "$ELECTRON_APP/Contents/Frameworks" -type f -perm +111 | while read -r binary; do
  codesign --force --sign - --entitlements "$ENTITLEMENTS" "$binary" 2>/dev/null || true
done

echo "Signing Electron.app..."
codesign --force --sign - --entitlements "$ENTITLEMENTS" "$ELECTRON_APP"

echo "Done. Electron.app is now ad-hoc signed with notification entitlements."
