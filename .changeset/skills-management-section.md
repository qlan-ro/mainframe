---
'@qlan-ro/mainframe-ui': patch
---

Manage skills from the Setup Advisor. The dialog now carries a section switcher beside its title: Recommendations (unchanged, still the default) and a new Skills section that lists the active project's skills by scope, searches them, opens one to read its SKILL.md, and deletes a project- or global-scope skill behind a confirmation. Deleting refreshes the section, the composer's `/` picker, and the sidebar Skills tab, which stays read-only and now links into the section.
