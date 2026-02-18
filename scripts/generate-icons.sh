#!/usr/bin/env bash
# One-time script to regenerate app icons from packages/desktop/resources/icon.svg.
# Requires: macOS (sips + iconutil built-in), internet access for npx png-to-ico
set -e

RESOURCES="packages/desktop/resources"
SVG="$RESOURCES/icon.svg"
PNG="$RESOURCES/icon.png"
ICNS="$RESOURCES/icon.icns"
ICO="$RESOURCES/icon.ico"
FAVICON="packages/desktop/src/renderer/favicon.png"
ICONSET="$RESOURCES/icon.iconset"

echo "Generating icon.png (1024x1024)..."
sips -s format png "$SVG" --out "$PNG" >/dev/null
sips -z 1024 1024 "$PNG" --out "$PNG" >/dev/null

echo "Generating favicon.png (32x32)..."
sips -z 32 32 "$PNG" --out "$FAVICON" >/dev/null

echo "Generating icon.icns..."
mkdir -p "$ICONSET"
for size in 16 32 64 128 256 512 1024; do
  sips -z $size $size "$PNG" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
done
cp "$ICONSET/icon_32x32.png"   "$ICONSET/icon_16x16@2x.png"
cp "$ICONSET/icon_64x64.png"   "$ICONSET/icon_32x32@2x.png"
cp "$ICONSET/icon_256x256.png" "$ICONSET/icon_128x128@2x.png"
cp "$ICONSET/icon_512x512.png" "$ICONSET/icon_256x256@2x.png"
cp "$ICONSET/icon_1024x1024.png" "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$ICNS"
rm -rf "$ICONSET"
echo "Generated icon.icns"

echo "Generating icon.ico..."
npx --yes png-to-ico "$PNG" > "$ICO"
echo "Generated icon.ico"

echo "Done. All icon assets in $RESOURCES"
