---
---

Release CI only: drop the macOS Intel (macos-13) Tauri leg that never gets a
runner, find the draft release by listing (the tags endpoint 404s on drafts) so
the dmg-rename step stops failing, and publish the release whenever the daemon
built so `mainframe update` artifacts are never blocked by a desktop build.
No package changelog.
