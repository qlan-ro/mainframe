---
version: 1
slug: "src-features-sessions"
primary_target: "src/features/sessions"
related_targets: ["src/layout/AppSidebar.tsx"]
---

# Sidebar

## Scope and mode
Operate. The session list: time groups, rows, filters, project scope. Canvas page "Sidebar". Spec rows: L in `design/redesign/DECISIONS.md`.

## Audience and job
Find the session that needs attention, or the one to resume, in a list of dozens.

## Constraints
Rows stay one line and 28 px tall. Virtualised list. Status must stay readable at a glance without colour alone. Branch, PR, tags, provider, lineage and missing-checkout warnings live in the row hover card. A new session's project and branch are picked in the strip above the composer, not on its welcome screen.

## Direction contract
THESIS: the project always leads and status replaces the time. This replaces a status glyph that pushed the project out.
OWN-WORLD: project letter tile, title, then one trailing value: a spinner, "needs you" in amber, or the time. No counts, no badges, no Unattended mark on rows.
STORY: the user scans by project, then reads the right edge for what needs them.
FIRST VIEWPORT: "Chats" header with search and collapse, "New session", project scope, then Today / Yesterday groups.
FORM: seed: none (pinned) "move any status indicator on the right, replace the time, I always want to see the project."
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment
A whole list where the only colour is the sessions that need you.

## Unresolved
None.
