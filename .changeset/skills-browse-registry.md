---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
'@qlan-ro/mainframe-app-tauri': patch
---

Browse skills.sh from the Setup Advisor. The Skills section now opens on a Browse tab listing the registry's most-installed skills, each installable in one click, with search covering the whole registry rather than the visible rows; the CLI's install manifest moves to an Installed tab. Two daemon routes back it, and the section degrades to search-only when the registry catalog can't be read.
