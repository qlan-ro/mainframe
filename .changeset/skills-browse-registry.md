---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
'@qlan-ro/mainframe-app-tauri': patch
---

Browse skills.sh from the Setup Advisor. The Skills section now opens on a Browse tab listing the registry's most-installed skills, each installable in one click, with search covering the whole registry rather than the visible rows; the CLI's install manifest moves to an Installed tab. Rows you already have are marked — spent where the chosen scope already has the skill, labelled with the other scope where it doesn't. Two daemon routes back it, and the section degrades to search-only when the registry catalog can't be read.
