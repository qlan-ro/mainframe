---
'@qlan-ro/mainframe-ui': patch
---

Fix two session/editor UX bugs:

- Selecting a project filter with no sessions now opens a new-session draft
  instead of stranding the previously-selected session from another project.
- The Markdown preview is now selectable, so its prose can be copied — the
  `mf-editor-selectable` opt-in class was referenced by the editor surfaces but
  never defined in the selection whitelist.
