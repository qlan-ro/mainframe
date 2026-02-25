# Open-Source Publication Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prepare the Mainframe repository for publication as `github.com/qlan/mainframe` — add all standard open-source files, strip internal documents from git tracking, create app icons, and produce a single squashed "Initial commit".

**Architecture:** Pure file operations — no logic changes. Creates/modifies config files, documentation, and binary icon assets. Icon generation uses a one-time shell script (`scripts/generate-icons.sh`) using macOS built-ins (`sips`, `iconutil`) plus `npx png-to-ico` for ICO — no permanent deps added. Generated icon files are committed so contributors never need to regenerate them. All tasks are independent and commit after each logical group.

**Tech Stack:** Git, Bash, macOS `sips` + `iconutil` (built-in), `npx png-to-ico` (one-time), `pnpm`.

---

### Task 1: Untrack Private Files

**Files:**
- Modify: `.gitignore`

**Step 1: Add private paths to `.gitignore`**

Open `.gitignore` and append at the end:

```gitignore
# Internal documents (not for public repo)
SECURITY_AUDIT.md
docs/plans/
docs/ideas/
docs/designs/
docs/adapters/
C4-Documentation/
.run/
```

**Step 2: Untrack all private files from git (keep local copies)**

```bash
git rm --cached SECURITY_AUDIT.md 2>/dev/null || true
git rm -r --cached docs/plans/ 2>/dev/null || true
git rm -r --cached docs/ideas/ 2>/dev/null || true
git rm -r --cached docs/designs/ 2>/dev/null || true
git rm -r --cached docs/adapters/ 2>/dev/null || true
git rm -r --cached C4-Documentation/ 2>/dev/null || true
git rm -r --cached .run/ 2>/dev/null || true
```

Expected: git reports files removed from index. Files still exist on disk.

**Step 3: Verify files are no longer tracked**

```bash
git status
```

Expected: The private paths appear under "Changes to be committed" as deleted. They do NOT appear under "Untracked files" (they are ignored by `.gitignore`).

**Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: untrack internal documents from public repo"
```

---

### Task 2: Fix .nvmrc and Add package.json Metadata

**Files:**
- Modify: `.nvmrc`
- Modify: `package.json`
- Modify: `packages/types/package.json`
- Modify: `packages/core/package.json`
- Modify: `packages/desktop/package.json`

**Step 1: Fix `.nvmrc`**

The file currently contains `25`. Change it to `20` to match `engines` field.

Open `.nvmrc` and replace contents with:
```
20
```

**Step 2: Add metadata to root `package.json`**

The root `package.json` is missing `license`, `repository`, `homepage`, and `bugs` fields. Add them after the `"description"` field:

```json
"license": "MIT",
"repository": {
  "type": "git",
  "url": "https://github.com/qlan/mainframe.git"
},
"homepage": "https://github.com/qlan/mainframe#readme",
"bugs": {
  "url": "https://github.com/qlan/mainframe/issues"
},
```

**Step 3: Add metadata to `packages/types/package.json`**

Add after `"version"`:
```json
"description": "Shared TypeScript types for Mainframe",
"license": "MIT",
"repository": {
  "type": "git",
  "url": "https://github.com/qlan/mainframe.git",
  "directory": "packages/types"
},
```

**Step 4: Add metadata to `packages/core/package.json`**

Add after `"version"`:
```json
"description": "Mainframe daemon — session lifecycle, agent process management, and metadata storage",
"license": "MIT",
"repository": {
  "type": "git",
  "url": "https://github.com/qlan/mainframe.git",
  "directory": "packages/core"
},
```

**Step 5: Add metadata to `packages/desktop/package.json`**

Add after `"version"`:
```json
"description": "Mainframe desktop app — Electron/React frontend for orchestrating AI agents",
"license": "MIT",
"repository": {
  "type": "git",
  "url": "https://github.com/qlan/mainframe.git",
  "directory": "packages/desktop"
},
```

**Step 6: Update clone URLs in docs**

In `CONTRIBUTING.md`, find:
```
git@github.com:doruchiulan/mainframe.git
```
Replace with:
```
https://github.com/qlan/mainframe.git
```

In `docs/DEVELOPER-GUIDE.md`, find and replace the same string.

**Step 7: Verify no remaining personal identifiers**

```bash
grep -r "doruchiulan" . --include="*.md" --include="*.json" --include="*.ts" --exclude-dir=node_modules --exclude-dir=.git
```

Expected: zero matches (or only in gitignored files).

**Step 8: Commit**

```bash
git add .nvmrc package.json packages/types/package.json packages/core/package.json packages/desktop/package.json CONTRIBUTING.md docs/DEVELOPER-GUIDE.md
git commit -m "chore: update package metadata and fix Node version"
```

---

### Task 3: Add LICENSE

**Files:**
- Create: `LICENSE`

**Step 1: Create `LICENSE`**

```
MIT License

Copyright (c) 2026 Mainframe Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**Step 2: Commit**

```bash
git add LICENSE
git commit -m "chore: add MIT license"
```

---

### Task 4: Add Community Health Files

**Files:**
- Create: `CODE_OF_CONDUCT.md`
- Create: `SECURITY.md`
- Create: `CHANGELOG.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `.github/ISSUE_TEMPLATE/feature_request.md`
- Create: `.github/pull_request_template.md`

**Step 1: Create `CODE_OF_CONDUCT.md`**

```markdown
# Contributor Covenant Code of Conduct

## Our Pledge

We as members, contributors, and leaders pledge to make participation in our
community a harassment-free experience for everyone, regardless of age, body
size, visible or invisible disability, ethnicity, sex characteristics, gender
identity and expression, level of experience, education, socio-economic status,
nationality, personal appearance, race, caste, color, religion, or sexual
identity and orientation.

We pledge to act and interact in ways that contribute to an open, welcoming,
diverse, inclusive, and healthy community.

## Our Standards

Examples of behavior that contributes to a positive environment:

- Demonstrating empathy and kindness toward other people
- Being respectful of differing opinions, viewpoints, and experiences
- Giving and gracefully accepting constructive feedback
- Accepting responsibility and apologizing to those affected by our mistakes
- Focusing on what is best not just for us as individuals, but for the overall community

Examples of unacceptable behavior:

- The use of sexualized language or imagery, and sexual attention or advances of any kind
- Trolling, insulting or derogatory comments, and personal or political attacks
- Public or private harassment
- Publishing others' private information without their explicit permission
- Other conduct which could reasonably be considered inappropriate in a professional setting

## Enforcement Responsibilities

Community leaders are responsible for clarifying and enforcing our standards of
acceptable behavior and will take appropriate and fair corrective action in
response to any behavior that they deem inappropriate, threatening, offensive,
or harmful.

## Scope

This Code of Conduct applies within all community spaces, and also applies when
an individual is officially representing the community in public spaces.

## Enforcement

Instances of abusive, harassing, or otherwise unacceptable behavior may be
reported by opening a GitHub issue or contacting the maintainers directly via
GitHub. All complaints will be reviewed and investigated promptly and fairly.

## Attribution

This Code of Conduct is adapted from the [Contributor Covenant](https://www.contributor-covenant.org),
version 2.1, available at https://www.contributor-covenant.org/version/2/1/code_of_conduct.html.
```

**Step 2: Create `SECURITY.md`**

```markdown
# Security Policy

## Reporting a Vulnerability

We take security seriously. If you discover a vulnerability in Mainframe, please
report it responsibly.

**Use GitHub's private vulnerability reporting:**
Go to the [Security tab](https://github.com/qlan/mainframe/security/advisories/new)
and click "Report a vulnerability". This keeps the details private until a fix is available.

**What to expect:**
- Acknowledgment within 48 hours
- Status update within 7 days
- No public disclosure before a fix is released

## Scope

Mainframe runs as a local desktop application with no cloud components. The daemon
binds to localhost only and has no authentication by design — it is not intended
to be exposed to a network. Reports about the daemon being accessible over a network
are out of scope.

## Known Limitations

- The daemon API has no authentication. Do not expose port 31415 to a network.
- Electron's renderer process has Node.js integration disabled by default.
```

**Step 3: Create `CHANGELOG.md`**

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — 2026-02-18

Initial public release.

### Features

- Multi-session management with tabbed navigation
- Claude CLI adapter with full session lifecycle (start, resume, interrupt)
- Permission gating — review and approve each tool use before execution
- Live context window usage and cost tracking
- Session history replay via Claude CLI `--resume`
- Skills support — extend agents with project-specific tools and instructions
- Agent subagent tracking (left panel Agents tab)
- Keyboard-first navigation
- Dark theme with per-adapter accent colors
```

**Step 4: Create `.github/ISSUE_TEMPLATE/bug_report.md`**

```markdown
---
name: Bug report
about: Something isn't working
labels: bug
---

**Describe the bug**
A clear description of what went wrong.

**Steps to reproduce**
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What you expected to happen.

**Actual behavior**
What actually happened.

**Environment**
- OS: [e.g. macOS 15.2]
- Node.js version: [e.g. 20.11.0]
- Claude CLI version: [run `claude --version`]
- Mainframe version: [e.g. 0.1.0]

**Logs**
Paste any relevant logs from the daemon (set `LOG_LEVEL=debug` in `.env`).
```

**Step 5: Create `.github/ISSUE_TEMPLATE/feature_request.md`**

```markdown
---
name: Feature request
about: Suggest an improvement or new capability
labels: enhancement
---

**Problem**
What problem does this solve? Who experiences it?

**Proposed solution**
Describe what you'd like to see.

**Alternatives considered**
Other approaches you thought about and why you rejected them.

**Additional context**
Any other context, screenshots, or references.
```

**Step 6: Create `.github/pull_request_template.md`**

```markdown
## What changed

Brief description of the change.

## Why

Why this change is needed.

## Testing done

How you verified the change works.

## Checklist

- [ ] `pnpm test` passes
- [ ] `pnpm build` passes (TypeScript compiles)
- [ ] No secrets in staged files
- [ ] File size limits respected (max 300 lines/file, 50 lines/function)
```

**Step 7: Commit**

```bash
git add CODE_OF_CONDUCT.md SECURITY.md CHANGELOG.md .github/
git commit -m "chore: add community health files"
```

---

### Task 5: Generate App Icons

> **Note:** The generated binary files (`icon.png`, `icon.icns`, `icon.ico`, `favicon.png`) are committed to the repo. Contributors never need to run this script — it exists only for future icon regeneration.

**Files:**
- Create: `packages/desktop/resources/icon.svg`
- Create: `scripts/generate-icons.sh`
- Create (generated, committed): `packages/desktop/resources/icon.png`
- Create (generated, committed): `packages/desktop/resources/icon.icns`
- Create (generated, committed): `packages/desktop/resources/icon.ico`
- Create (generated, committed): `packages/desktop/src/renderer/favicon.png`

**Step 1: Create the SVG source**

Create `packages/desktop/resources/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <!-- Dark background circle -->
  <circle cx="512" cy="512" r="512" fill="#1c1c1e"/>
  <!-- Bold M -->
  <text
    x="512"
    y="512"
    text-anchor="middle"
    dominant-baseline="central"
    font-family="system-ui, -apple-system, 'Helvetica Neue', sans-serif"
    font-size="560"
    font-weight="700"
    fill="#f07c39"
  >M</text>
</svg>
```

**Step 2: Create the generation script**

Create `scripts/generate-icons.sh` (uses macOS built-ins only, plus one `npx` call):

```bash
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
# Rename to match iconutil expected names
mv "$ICONSET/icon_16x16.png"   "$ICONSET/icon_16x16.png"
mv "$ICONSET/icon_32x32.png"   "$ICONSET/icon_32x32.png"
mv "$ICONSET/icon_128x128.png" "$ICONSET/icon_128x128.png"
mv "$ICONSET/icon_256x256.png" "$ICONSET/icon_256x256.png"
mv "$ICONSET/icon_512x512.png" "$ICONSET/icon_512x512.png"
iconutil -c icns "$ICONSET" -o "$ICNS"
rm -rf "$ICONSET"
echo "Generated icon.icns"

echo "Generating icon.ico..."
npx --yes png-to-ico "$PNG" > "$ICO"
echo "Generated icon.ico"

echo "Done. All icon assets in $RESOURCES"
```

**Step 3: Run the generation script**

```bash
bash scripts/generate-icons.sh
```

Expected output:
```
Generating icon.png (1024x1024)...
Generating favicon.png (32x32)...
Generating icon.icns...
Generated icon.icns
Generating icon.ico...
Generated icon.ico
Done. All icon assets in packages/desktop/resources
```

**Step 4: Verify files were created**

```bash
ls -lh packages/desktop/resources/
ls -lh packages/desktop/src/renderer/favicon.png
```

Expected: `icon.svg`, `icon.png`, `icon.icns`, `icon.ico` all present with non-zero sizes; `favicon.png` present at 32×32.

**Step 5: Commit**

```bash
git add packages/desktop/resources/icon.svg packages/desktop/resources/icon.png packages/desktop/resources/icon.icns packages/desktop/resources/icon.ico packages/desktop/src/renderer/favicon.png scripts/generate-icons.sh
git commit -m "feat: add app icon assets (M monogram)"
```

---

### Task 6: Wire Icons into Electron and electron-builder

**Files:**
- Modify: `packages/desktop/package.json`
- Modify: `packages/desktop/src/main/index.ts`
- Modify: `packages/desktop/src/renderer/index.html`

**Step 1: Add electron-builder config to `packages/desktop/package.json`**

Add a `"build"` section at the end of the JSON (before the closing `}`):

```json
"build": {
  "appId": "com.qlan.mainframe",
  "productName": "Mainframe",
  "icon": "resources/icon",
  "files": [
    "out/**/*",
    "resources/**/*",
    "package.json"
  ],
  "publish": {
    "provider": "github",
    "owner": "qlan",
    "repo": "mainframe"
  },
  "mac": {
    "category": "public.app-category.developer-tools",
    "target": ["dmg", "zip"]
  },
  "win": {
    "target": ["nsis"]
  },
  "linux": {
    "target": ["AppImage"],
    "category": "Development"
  }
}
```

`"files"` limits what electron-builder bundles — only the built output (`out/`) and icon resources. Without this, it bundles source files, test files, and coverage reports unnecessarily. `"publish"` enables `electron-builder` to upload artifacts to GitHub Releases when run with `--publish always` (used by the release workflow below).

**Step 2: Add icon to BrowserWindow (Linux)**

Open `packages/desktop/src/main/index.ts`. Find the `BrowserWindow` constructor call and add `icon` for Linux only (macOS and Windows read the icon from electron-builder automatically):

Find:
```ts
mainWindow = new BrowserWindow({
  width: 1400,
  height: 900,
```

Replace with:
```ts
mainWindow = new BrowserWindow({
  width: 1400,
  height: 900,
  ...(process.platform === 'linux' && {
    icon: join(__dirname, '../../resources/icon.png'),
  }),
```

Ensure `join` is imported — check the top of the file for `import { join } from 'node:path'`. If it's not there, add it.

**Step 3: Add favicon to `index.html`**

Open `packages/desktop/src/renderer/index.html`. Find the `<head>` section and add after the `<title>` tag:

```html
<link rel="icon" type="image/png" href="/favicon.png">
```

**Step 4: TypeScript check**

```bash
pnpm --filter @mainframe/desktop build
```

Expected: Builds without errors.

**Step 5: Add GitHub release workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 8

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm build

      - name: Package
        run: pnpm --filter @mainframe/desktop package -- --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

This triggers on any `v*` tag (e.g. `git tag v0.1.0 && git push --tags`). Each platform builds its own artifact and uploads it to the GitHub Release automatically using `GH_TOKEN` (available by default in Actions, no secrets config needed).

**Step 6: Commit**

```bash
git add packages/desktop/package.json packages/desktop/src/main/index.ts packages/desktop/src/renderer/index.html .github/workflows/release.yml
git commit -m "feat: wire app icons into electron and electron-builder, add release workflow"
```

---

### Task 7: Write README.md

**Files:**
- Create: `README.md`

**Step 1: Create `README.md`**

```markdown
<h1 align="center">Mainframe</h1>

<p align="center">
  AI-native development environment for orchestrating agents
</p>

<p align="center">
  <a href="https://github.com/qlan/mainframe/actions/workflows/ci.yml">
    <img src="https://github.com/qlan/mainframe/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/qlan/mainframe" alt="MIT License">
  </a>
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="Mainframe screenshot" width="860">
</p>

> **Note:** Screenshot coming soon. Run the app locally to see it in action.

---

## What is Mainframe?

Mainframe is an open-source desktop application for running, supervising, and orchestrating AI coding agents on your own machine. It wraps CLI-based agents (starting with Claude CLI) in a structured interface that keeps the engineer in control at every step.

Most AI coding tools are designed to run autonomously. Mainframe takes a different approach: you see what the agent is doing, approve each tool use before it executes, and can intervene at any point. It's a human-in-the-loop environment built for developers who want the speed of AI assistance without giving up oversight.

## Features

- **Multi-session management** — Run multiple agent sessions simultaneously with tabbed navigation
- **Permission gating** — Review and approve each tool use before it executes; never surprised by what ran
- **Context tracking** — Live context window usage and cost monitoring per session
- **Session resume** — Sessions survive daemon restarts; pick up exactly where you left off
- **Skills** — Extend agents with project-specific tools and instructions via `.claude/skills/`
- **Subagent tracking** — Visual overview of parallel agent tasks spawned within a session
- **Keyboard-first** — Full keyboard navigation (⌘N new session, ⌘F search, ⌘, settings)

## Prerequisites

- **Node.js** 20 or later
- **pnpm** 8 or later (`npm install -g pnpm`)
- **Claude CLI** — [Install instructions](https://claude.ai/code) (requires a Claude account)

## Quick Start

```bash
git clone https://github.com/qlan/mainframe.git
cd mainframe
pnpm install
pnpm build
pnpm dev
```

This starts both the daemon (`localhost:31415`) and the Electron desktop app.

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, data flow, package breakdown |
| [API Reference](docs/API-REFERENCE.md) | HTTP and WebSocket API for the daemon |
| [Developer Guide](docs/DEVELOPER-GUIDE.md) | Setup, workflow, monorepo conventions |
| [Contributing](CONTRIBUTING.md) | How to contribute, code standards, PR process |

## Environment Variables

All environment variables are optional — the application works without a `.env` file.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `31415` | Daemon HTTP port |
| `LOG_LEVEL` | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`) |
| `NODE_ENV` | `development` | Environment mode |

Copy `.env.example` to `.env` to customize.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and feature requests go in [GitHub Issues](https://github.com/qlan/mainframe/issues).

## License

[MIT](LICENSE) — © 2026 Mainframe Contributors
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

### Task 8: Final Verification

**Step 1: Run full build**

```bash
pnpm build
```

Expected: Exits 0. No TypeScript errors.

**Step 2: Run tests**

```bash
pnpm test
```

Expected: All tests pass.

**Step 3: Verify no private files are tracked**

```bash
git ls-files | grep -E "(SECURITY_AUDIT|docs/plans|docs/ideas|docs/designs|docs/adapters|C4-Documentation|\.run/)"
```

Expected: No output (empty).

**Step 4: Verify all required files exist**

```bash
ls LICENSE README.md CODE_OF_CONDUCT.md SECURITY.md CHANGELOG.md
ls .github/ISSUE_TEMPLATE/ .github/pull_request_template.md
ls packages/desktop/resources/icon.svg packages/desktop/resources/icon.png packages/desktop/resources/icon.icns packages/desktop/resources/icon.ico
ls packages/desktop/src/renderer/favicon.png
```

Expected: All files present, no "No such file" errors.

**Step 5: Verify no personal identifiers remain**

```bash
grep -r "doruchiulan" . --include="*.md" --include="*.json" --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.git
```

Expected: No matches.

---

### Task 9: Squash and Publish

> **Important:** This is irreversible once pushed. Verify Task 8 passes before proceeding.

**Step 1: Squash all commits into one**

```bash
# Find the root commit hash
FIRST_COMMIT=$(git rev-list --max-parents=0 HEAD)
echo "Root commit: $FIRST_COMMIT"

# Soft reset to root (stages all changes since the beginning)
git reset --soft "$FIRST_COMMIT"

# The root commit itself exists — we need to go before it.
# Use an orphan approach instead:
git checkout --orphan publish-branch
git add -A
git commit -m "Initial commit"
```

**Step 2: Verify the new branch has exactly one commit**

```bash
git log --oneline
```

Expected: exactly one line: `<hash> Initial commit`

**Step 3: Verify private files are not in the commit**

```bash
git show --name-only HEAD | grep -E "(SECURITY_AUDIT|docs/plans|docs/ideas|docs/designs|docs/adapters|C4-Documentation|\.run/)"
```

Expected: No output.

**Step 4: Create the GitHub org and repository**

In a browser:
1. Go to `https://github.com/organizations/new`
2. Create org named `qlan`
3. Go to `https://github.com/organizations/qlan/repositories/new`
4. Name: `mainframe`, visibility: Public, **do not initialize** (no README, no .gitignore, no license — we're pushing our own)

**Step 5: Add remote and push**

```bash
git remote add origin https://github.com/qlan/mainframe.git
git push -u origin publish-branch:main
```

**Step 6: Verify on GitHub**

Open `https://github.com/qlan/mainframe` and confirm:
- 1 commit in history
- README renders correctly
- License detected as MIT
- No private files visible
