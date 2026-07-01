---
"@qlan-ro/mainframe-ui": minor
"@qlan-ro/mainframe-core": minor
"@qlan-ro/mainframe-types": patch
---

Add the Workflows UI (Stage 2): a fullview (Needs-you inbox, Runs list, Library, and a live rail run-detail tree) plus a YAML/builder authoring editor, wired to the daemon's Workflows REST/WS API. Adds `GET /api/workflows/:id` (returns the workflow's YAML for editing) and tightens `WorkflowInteractionSummary.formSchema` to `QuestionField[]`.
