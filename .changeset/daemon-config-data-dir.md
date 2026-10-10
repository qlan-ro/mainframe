---
'@qlan-ro/mainframe-app-tauri': patch
---

The configured `dataDir` now applies to the database and to both the daemon's and the desktop app's logs. An existing database in the previous default location moves to the configured directory on startup, including to another volume; if the move fails, Mainframe keeps using the existing database and tries again on the next start.

Startup claims the daemon port before opening the database, and migration retains SQLite exclusion until the move finishes so another connection cannot write during relocation.
