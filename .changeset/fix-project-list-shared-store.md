---
'@qlan-ro/mainframe-ui': patch
---

Fix a project added from the empty first-run state never appearing until a full reload. `useProjects()` moved from a per-caller `useState` to a shared `store/projects.ts` store, so a reload issued from one mounted consumer (e.g. the "Add project" CTA) now updates every other one — the sidebar and chat surface included.
