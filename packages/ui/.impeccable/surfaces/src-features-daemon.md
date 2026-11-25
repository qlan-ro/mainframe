---
version: 1
slug: "src-features-daemon"
primary_target: "src/features/daemon"
related_targets: []
---

# Daemon switcher

The active daemon supplies the session list and project picker. Selecting it again keeps the connection and any pending list refresh. Selecting a different daemon clears the previous lists and loads the new daemon's data. A response from the previous daemon cannot populate the new lists.
