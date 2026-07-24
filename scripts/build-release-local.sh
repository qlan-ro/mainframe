#!/usr/bin/env bash
set -euo pipefail

# Build the release-pipeline deliverables on this machine. Mirrors the build
# steps of .github/workflows/release.yml WITHOUT its gates: no unit tests, no
# cargo fmt/clippy/test, no GitHub release upload.
#
# Default output is unsigned — no Developer ID, no notarization, no updater
# artifacts — because those need secrets the release job gets from CI. Opt into
# each with --sign / --notarize / --updater.
#
# Everything lands in $OUT_DIR with release-style names carrying the short SHA,
# so a locally-built dmg can never be confused with a downloaded one.

usage() {
  cat <<'EOF'
Usage: scripts/build-release-local.sh [targets] [options]

Targets (default: --tauri)
  --tauri         Tauri dmg, Rust daemon inside          (release.yml: build-app-tauri)
  --daemon        standalone daemon tarball              (release.yml: build-daemon)
  --all           both

Options
  --version <v>   bundle version           (default: root package.json version)
  --out <dir>     output directory         (default: dist-local)
  --sign          codesign with a Developer ID Application identity.
                  Uses $APPLE_SIGNING_IDENTITY, else auto-detects one from the keychain.
  --notarize      implies --sign; needs APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID.
  --updater       emit .app.tar.gz + .sig; needs TAURI_SIGNING_PRIVATE_KEY[_PASSWORD].
  --skip-deps     reuse the existing types/core/ui build output
  -h, --help      this message

Examples
  scripts/build-release-local.sh                     # Tauri dmg, unsigned
  scripts/build-release-local.sh --daemon            # just the standalone daemon tarball
  scripts/build-release-local.sh --all --sign        # everything, Developer ID signed
EOF
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WANT_TAURI=0 WANT_DAEMON=0 EXPLICIT_TARGETS=0
SIGN=0 NOTARIZE=0 UPDATER=0 SKIP_DEPS=0
VERSION="" OUT_DIR="$ROOT/dist-local"

while [ $# -gt 0 ]; do
  case "$1" in
    --tauri) WANT_TAURI=1 EXPLICIT_TARGETS=1 ;;
    --daemon) WANT_DAEMON=1 EXPLICIT_TARGETS=1 ;;
    --all) WANT_TAURI=1 WANT_DAEMON=1 EXPLICIT_TARGETS=1 ;;
    --sign) SIGN=1 ;;
    --notarize) NOTARIZE=1 SIGN=1 ;;
    --updater) UPDATER=1 ;;
    --skip-deps) SKIP_DEPS=1 ;;
    --version) VERSION="${2:?--version needs a value}"; shift ;;
    --out) OUT_DIR="${2:?--out needs a value}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [ "$EXPLICIT_TARGETS" -eq 0 ]; then WANT_TAURI=1; fi

VERSION="${VERSION:-$(node -p "require('$ROOT/package.json').version")}"
SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64; TAURI_ARCH=aarch64 ;;
  *) ARCH=x64; TAURI_ARCH=x64 ;;
esac
STAMP="${VERSION}-g${SHA}-macos-${ARCH}"
DMG_DIR="$ROOT/packages/app-tauri/src-tauri/target/release/bundle"

if [ "$(uname -s)" != "Darwin" ] && [ "$WANT_TAURI" -eq 1 ]; then
  echo "error: the dmg target is macOS-only (this is $(uname -s))." >&2
  exit 1
fi

# Signing is entirely env-driven downstream (Tauri gates on
# APPLE_SIGNING_IDENTITY; it notarizes only when APPLE_ID et al are present),
# so an unsigned build means clearing those rather than passing a flag.
if [ "$SIGN" -eq 1 ]; then
  if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
    APPLE_SIGNING_IDENTITY="$(security find-identity -v -p codesigning \
      | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)"
    [ -n "$APPLE_SIGNING_IDENTITY" ] || { echo "error: --sign but no Developer ID Application identity in the keychain." >&2; exit 1; }
  fi
  export APPLE_SIGNING_IDENTITY
  echo "signing identity: $APPLE_SIGNING_IDENTITY"
else
  unset APPLE_SIGNING_IDENTITY || true
fi

if [ "$NOTARIZE" -eq 1 ]; then
  : "${APPLE_ID:?--notarize needs APPLE_ID}"
  : "${APPLE_TEAM_ID:?--notarize needs APPLE_TEAM_ID}"
  : "${APPLE_APP_SPECIFIC_PASSWORD:?--notarize needs APPLE_APP_SPECIFIC_PASSWORD}"
  export APPLE_PASSWORD="$APPLE_APP_SPECIFIC_PASSWORD"
else
  unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_APP_SPECIFIC_PASSWORD || true
fi

if [ "$UPDATER" -eq 1 ]; then
  : "${TAURI_SIGNING_PRIVATE_KEY:?--updater needs TAURI_SIGNING_PRIVATE_KEY (key path or base64 contents)}"
fi

mkdir -p "$OUT_DIR"
echo "==> version $VERSION · sha $SHA · arch $ARCH · out $OUT_DIR"

if [ "$SKIP_DEPS" -eq 0 ]; then
  echo "==> building workspace dependencies (types → core → ui)"
  NODE_OPTIONS=--max-old-space-size=4096 \
    pnpm --filter "@qlan-ro/mainframe-core..." --filter "@qlan-ro/mainframe-ui..." build
fi

# `version` here is what gets baked into the bundle and its Info.plist —
# tauri.conf.json otherwise stays pinned at a hand-edited value, exactly as the
# release job's stamping step notes. Overriding via --config keeps the working
# tree clean instead of editing the tracked file.
tauri_overrides() {
  local updater="false"
  [ "$UPDATER" -eq 1 ] && updater="true"
  printf '{"version":"%s","bundle":{"createUpdaterArtifacts":%s}}' "$VERSION" "$updater"
}

# $1 = human label, $2 = output filename infix, $3.. = extra --config args
build_tauri() {
  local label="$1" infix="$2"; shift 2
  echo "==> building $label"
  ( cd "$ROOT/packages/app-tauri" && pnpm exec tauri build "$@" --config "$(tauri_overrides)" )

  local src="$DMG_DIR/dmg/Mainframe_${VERSION}_${TAURI_ARCH}.dmg"
  [ -f "$src" ] || { echo "error: expected dmg not found at $src" >&2; exit 1; }
  mv "$src" "$OUT_DIR/Mainframe-tauri-${infix}${STAMP}.dmg"

  if [ "$UPDATER" -eq 1 ]; then
    for f in "$DMG_DIR"/macos/*.app.tar.gz "$DMG_DIR"/macos/*.app.tar.gz.sig; do
      [ -e "$f" ] || continue
      case "$f" in
        *.sig) mv "$f" "$OUT_DIR/Mainframe-tauri-${infix}${STAMP}.app.tar.gz.sig" ;;
        *) mv "$f" "$OUT_DIR/Mainframe-tauri-${infix}${STAMP}.app.tar.gz" ;;
      esac
    done
  fi
}

if [ "$WANT_TAURI" -eq 1 ]; then
  build_tauri "Tauri dmg (Rust daemon)" ""
fi

if [ "$WANT_DAEMON" -eq 1 ]; then
  echo "==> building standalone daemon tarball"
  bash "$ROOT/scripts/build-standalone.sh" darwin "$ARCH"
  for f in "$ROOT"/dist-standalone/*.tar.gz; do
    [ -e "$f" ] || continue
    cp "$f" "$OUT_DIR/"
  done
fi

echo
echo "==> deliverables in $OUT_DIR"
ls -lh "$OUT_DIR"
[ "$SIGN" -eq 0 ] && echo "note: unsigned build — fine locally, not shareable."
exit 0
