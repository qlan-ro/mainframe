#!/usr/bin/env bash
set -euo pipefail

REPO="qlan-ro/mainframe"
INSTALL_DIR="${MAINFRAME_INSTALL_DIR:-$HOME/.mainframe/bin}"

# Detect OS
case "$(uname -s)" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux" ;;
  *)      echo "Unsupported OS: $(uname -s). Use Docker instead." >&2; exit 1 ;;
esac

# Detect architecture
case "$(uname -m)" in
  x86_64|amd64)  ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)             echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

ARTIFACT="mainframe-daemon-${OS}-${ARCH}.tar.gz"
echo "Detected platform: ${OS}-${ARCH}"

# Get latest release URL
RELEASE_URL="https://api.github.com/repos/${REPO}/releases/latest"
echo "Fetching latest release..."
DOWNLOAD_URL=$(curl -fsSL "$RELEASE_URL" | grep "browser_download_url.*${ARTIFACT}" | head -1 | cut -d '"' -f 4)

if [ -z "$DOWNLOAD_URL" ]; then
  echo "No release found for ${ARTIFACT}. Check https://github.com/${REPO}/releases" >&2
  exit 1
fi

# Download and extract
echo "Downloading ${ARTIFACT}..."
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
curl -fsSL "$DOWNLOAD_URL" -o "${TMP_DIR}/${ARTIFACT}"

echo "Installing to ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"
tar -xzf "${TMP_DIR}/${ARTIFACT}" -C "$INSTALL_DIR" --strip-components=1

chmod +x "${INSTALL_DIR}/bin/mainframe-daemon"

# PATH check
if ! echo "$PATH" | tr ':' '\n' | grep -q "${INSTALL_DIR}/bin"; then
  echo ""
  echo "Add to your PATH:"
  echo "  export PATH=\"${INSTALL_DIR}/bin:\$PATH\""
  echo ""
  echo "Or add that line to your ~/.zshrc or ~/.bashrc"
fi

echo ""
echo "Installed mainframe-daemon to ${INSTALL_DIR}/bin/mainframe-daemon"
echo "Run 'mainframe-daemon' to start the daemon"
echo ""
