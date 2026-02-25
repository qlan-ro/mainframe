# Open-Source Publication Readiness

**Date:** 2026-02-18
**Status:** Approved
**Target repo:** `github.com/qlan/mainframe`
**License:** MIT
**Publish method:** Squash all commits → single "Initial commit" → push as public repo

---

## Context

The project has no README, no LICENSE, no app icons, and several internal working documents tracked in git (security audit with exploit PoCs, daily work plans, brainstorming docs, C4 drafts, design files, IDE configs). This plan brings the repo to standard open-source hygiene before publication.

---

## Section 1 — Remove from Git Tracking

Add to `.gitignore` and untrack with `git rm --cached`. History is not an issue because all commits will be squashed into a single "Initial commit" before publishing.

| Path | Reason |
|------|--------|
| `SECURITY_AUDIT.md` | Exploit PoCs, unfixed vulnerability findings, local absolute paths |
| `docs/plans/` | 18 internal daily work planning files |
| `docs/ideas/` | Internal brainstorm documents |
| `docs/designs/` | Internal design specs and `.pen` files |
| `docs/adapters/` | Reverse-engineered Claude CLI protocol notes |
| `C4-Documentation/` | Internal C4 architecture drafts |
| `.run/` | JetBrains IDE run configurations |

The `docs/` directory retains all public-facing documentation:
- `docs/ARCHITECTURE.md`
- `docs/API-REFERENCE.md`
- `docs/DEVELOPER-GUIDE.md`
- `docs/TECH-DEBT-REPORT.md`

---

## Section 2 — Files to Create

### `LICENSE`
MIT license, year 2026, copyright holder "Mainframe Contributors".

### `README.md`
Full README including:
- CI status badge and license badge
- One-line pitch: "AI-native development environment for orchestrating agents"
- Screenshot placeholder
- Feature highlights
- Prerequisites: Node.js 20+, pnpm, Claude CLI (with Claude account)
- Setup commands (clone, install, build, dev)
- Links to `docs/ARCHITECTURE.md`, `docs/API-REFERENCE.md`, `docs/DEVELOPER-GUIDE.md`, `CONTRIBUTING.md`
- "Why this exists" paragraph

### `CODE_OF_CONDUCT.md`
Contributor Covenant 2.1 boilerplate with a contact email placeholder.

### `SECURITY.md`
Security disclosure policy:
- Use GitHub's private vulnerability reporting
- Maintainers acknowledge within 48 hours
- No public disclosure before a fix is available

### `.github/ISSUE_TEMPLATE/bug_report.md`
Fields: description, steps to reproduce, expected vs actual behavior, environment (OS, Node version, Claude CLI version).

### `.github/ISSUE_TEMPLATE/feature_request.md`
Fields: problem statement, proposed solution, alternatives considered.

### `.github/pull_request_template.md`
Fields: what changed, why, testing done, checklist (tests pass, typecheck passes, no secrets).

### `CHANGELOG.md`
Single entry:
```
## [0.1.0] — 2026-02-18
Initial public release.
```

---

## Section 3 — Files to Update

| File | Change |
|------|--------|
| `.gitignore` | Add patterns for all private paths listed in Section 1 |
| `CONTRIBUTING.md` | Update clone URL: `doruchiulan/mainframe` → `qlan/mainframe` |
| `docs/DEVELOPER-GUIDE.md` | Update clone URL: `doruchiulan/mainframe` → `qlan/mainframe` |
| `package.json` (root) | Add `"repository"`, `"homepage"`, `"bugs"` fields pointing to `qlan/mainframe` |
| `packages/types/package.json` | Add `"description"` and `"repository"` fields |
| `packages/core/package.json` | Add `"description"` and `"repository"` fields |
| `packages/desktop/package.json` | Add `"description"` and `"repository"` fields; add `"build"` section for electron-builder |
| `.nvmrc` | Fix `25` → `20` to match `engines` field |

---

## Section 4 — App Icons

**Source design:** Circle with dark background (`#1c1c1e`), bold letter `M` in Claude orange (`#f07c39`, matching `oklch(0.705 0.187 48)`), centered. Matches the in-app empty state visual.

### Files to create

| File | Purpose |
|------|---------|
| `packages/desktop/resources/icon.svg` | Vector source asset |
| `packages/desktop/resources/icon.png` | 1024×1024 PNG derived from SVG |
| `packages/desktop/resources/icon.icns` | macOS app icon |
| `packages/desktop/resources/icon.ico` | Windows app icon |
| `packages/desktop/src/renderer/favicon.png` | 32×32 favicon for the browser tab |

### Generation method
1. Author `icon.svg` manually (circle + bold M, 1024×1024 viewBox)
2. Convert SVG → PNG via `sharp` (Node.js, already in ecosystem or added as dev dep)
3. PNG → `.icns` via macOS `iconutil` (built-in on macOS)
4. PNG → `.ico` via `png-to-ico` npm package

### Config changes
- `packages/desktop/package.json` — add `"build"` section: `{ "icon": "resources/icon" }`
- `packages/desktop/src/main/index.ts` — add `icon` property to `BrowserWindow` config (Linux only; macOS/Windows read from electron-builder)
- `packages/desktop/src/renderer/index.html` — add `<link rel="icon" href="/favicon.png">`

---

## Publish Checklist

- [ ] Add all Section 1 paths to `.gitignore`
- [ ] Run `git rm --cached` for all Section 1 paths
- [ ] Create all Section 2 files
- [ ] Apply all Section 3 updates
- [ ] Generate icon assets and apply Section 4 config changes
- [ ] Run `pnpm build` and `pnpm test` — all must pass
- [ ] Squash all commits: `git reset --soft $(git rev-list --max-parents=0 HEAD)` then commit as "Initial commit"
- [ ] Create `qlan` GitHub org (if not exists)
- [ ] Create `github.com/qlan/mainframe` as public repo
- [ ] Push
