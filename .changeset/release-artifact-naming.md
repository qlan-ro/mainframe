---
---

Release tooling only: give release assets a consistent, self-documenting scheme —
`Mainframe-<shell>-<version>-macos-<arch>.dmg` (shell = electron|tauri, arch = arm64|x64).
Electron installers gain an explicit `artifactName`, the Tauri dmg is normalized in CI
(the updater `.app.tar.gz`/`latest.json` are untouched), and the `release` job's upload
globs are curated so build metadata (`builder-debug.yml`) no longer lands on the release.
No package changelog.
