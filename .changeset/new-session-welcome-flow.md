---
"@qlan-ro/mainframe-types": minor
"@qlan-ro/mainframe-core": minor
"@qlan-ro/mainframe-ui": minor
---

New-session welcome flow: the "+" resolves the project before the chat opens (directly with a project pill active, or via an anchored project-picker popover in "All" view), a draft "New Session" row appears at the top of the sidebar, the empty chat becomes a designed Welcome state with repo-derived suggestion rows that pre-fill the composer, and first-run (zero projects) shows a dedicated "Add project…" hero. Backed by a new `GET /api/projects/:id/suggestions` endpoint (recent churn + a bounded TODO-comment scan) and a canonical `Suggestion` type. The old in-surface "choose a project" interstitial is removed.
