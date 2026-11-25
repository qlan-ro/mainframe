---
version: 1
slug: "src-layout-titlebar-tsx"
primary_target: "src/layout/TitleBar.tsx"
related_targets: ["src/app/AppShell.tsx","src/features/session-tabs","src/features/quota"]
---

# Shell & title bar

## Scope and mode
Operate. The window frame: title bar segments (usage capsule, session tabs, Search, Chat / Workspace toggles; the workspace tabs themselves belong to Workspace), nav rail, shortcuts sheet. Canvas page "Shell & title bar". Code and boards: `design/areas.json` (area `shell`). Spec rows: S, W1–W3, H in `design/redesign/DECISIONS.md`.

## Audience and job
A developer running several agent sessions at once. They switch between sessions and see usage at a glance, without the frame competing with the work.

## Constraints
Native macOS window chrome: traffic lights, a full-width title bar, a drag region. The shell keeps today's structure (S1). The shared pane beside the rail has a clipped 10 px top-left corner and a single 1 px border along the top and rail edges (S2). Overlay scrollbars everywhere (S3).

## Direction contract
THESIS: the frame lines up with the columns it serves. Title-bar segments sit exactly over the column edges below, instead of a generic toolbar laid across the top.
OWN-WORLD: grey ground, 1 × 16 hairline separators, 32 px tabs, plain icon toggles with a soft fill when on. No outlined segmented controls.
STORY: the user knows which session is open, what is running and where the workspace starts, from the frame alone.
FIRST VIEWPORT: traffic lights and usage capsule | session tabs | workspace tabs, + and Files | Search and Chat / Workspace, right-aligned.
FORM: seed: none (pinned) "The shell matches today's app" (S1).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment
Opening the workspace adds a third segment whose separator lands exactly on the panel's edge.

The usage capsule is capped at 224 px and shrinks with a narrow sidebar. Separators use the stronger hairline. The collapsed segment places its separator 12 px after the capsule.

## Unresolved
None.
