---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
'@qlan-ro/mainframe-app-tauri': patch
---

Browse skills.sh from the Setup Advisor. The Skills section is now one list — the skills you have, then the registry's most-installed — with search covering the whole registry rather than the visible rows. An installed row reads "Installed" and swaps to Uninstall on hover, so no row offers to install something you already have; installing asks which scope on the Install button itself, at the moment you install. Two daemon routes back it, and the list degrades to search-only when the registry catalog can't be read, keeping your installed rows. Both reads report themselves: the list waits as skeletons rather than briefly offering to install skills you already have, and a refresh or a search marks the search field while it runs.
