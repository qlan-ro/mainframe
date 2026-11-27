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
Rows stay one line and 28 px tall. Virtualised list. Status must stay readable at a glance without colour alone. Branch, PR, tags, provider, lineage and missing-checkout warnings live in the row hover card. Pick a new session's project and branch in the composer strip. Its welcome screen uses that selection to show the checkout, recent sessions and open tasks. Choosing the active daemon again keeps a pending sidebar refresh in flight. A refresh started before a daemon switch cannot populate the new sidebar.

At boot the sidebar, its empty state ("No sessions yet", "0 projects") and the new-session welcome are not painted until the remembered chat is restored (`boot-restore`); they show the final list at once, and the welcome only when there is nothing to restore.

## Direction contract
THESIS: the project always leads and status replaces the time. This replaces a status glyph that pushed the project out.
OWN-WORLD: project letter tile, title, then one trailing value: a spinner, "needs you" in amber, or the time. No counts, no badges, no Unattended mark on rows.
STORY: the user scans by project, then reads the right edge for what needs them.
FIRST VIEWPORT: "Chats" header with search and collapse, "New session", project scope, then Today / Yesterday groups.
FORM: seed: none (pinned) "move any status indicator on the right, replace the time, I always want to see the project."
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment
A whole list where the only colour is the sessions that need you.

The Chats header is 44 px tall. Its icon buttons and the New session row are 32 px tall.

Session rows use opaque hover and selection fills. Hover uses #ededf0 in light and #262628 in dark. Selection uses #ececef in light and #2f2f31 in dark.

## Unresolved
None.
