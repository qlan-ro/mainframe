#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../packages/mobile"
exec npx expo start --clear
