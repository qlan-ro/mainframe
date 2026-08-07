---
'@qlan-ro/mainframe-ui': patch
---

Fix the session panel never appearing in packaged builds: the panel's width measurement ran once before the chat surface's initializing branch gave way to the real layout row, so the observer never attached and the panel stayed permanently hidden. The host is now a state-backed callback ref that re-measures whenever the row mounts. Dev servers booted fast enough to always win that race, which is why it only ever reproduced in release builds.
