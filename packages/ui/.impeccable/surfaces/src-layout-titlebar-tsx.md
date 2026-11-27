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

The usage capsule places the cycle dots at the right edge and exposes the full provider and window name when its label lane clips.

## Direction contract
THESIS: the frame lines up with the columns it serves. Title-bar segments sit exactly over the column edges below, instead of a generic toolbar laid across the top.
OWN-WORLD: grey ground, 1 × 16 hairline separators, 32 px tabs, plain icon toggles with a soft fill when on. No outlined segmented controls.
STORY: the user knows which session is open, what is running and where the workspace starts, from the frame alone.
FIRST VIEWPORT: traffic lights and usage capsule | session tabs | workspace tabs, + and Files | Search and Chat / Workspace, right-aligned.
FORM: seed: none (pinned) "The shell matches today's app" (S1).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment
Opening the workspace adds a third segment whose separator lands exactly on the panel's edge.

The usage capsule is capped at 224 px and shrinks with a narrow sidebar. The open-sidebar segment no longer adds fixed right padding before its separator. Separators use the stronger hairline.

## Boot
The first frame is the ground (`sidebar` token, `#f5f5f8` light, `#262626` dark): the window's `backgroundColor`, the `index.html` background and the stored theme (`public/boot-theme.js`) all agree, so nothing paints white. The "Starting up" card is part of the wait only after 200 ms and stays at least 300 ms once shown. Once the shell is up it holds one stable frame: the rail, the content card under an opaque cover, and the title bar with an empty usage capsule. The session tabs and the Chat / Workspace actions are mounted but not painted. Everything under the cover stays mounted, laid out and focusable (never `visibility:hidden`, which makes WebKit drop the composer's autofocus), and the cover is marked as a preview overlay so a native preview webview steps aside. A spinner appears on the cover only after 400 ms. The cover lifts when the remembered chat's history is in, its transcript is mounted in the chat column and the first pin has landed at its tail, or after 1.5 s (`features/sessions/runtime/boot-restore.ts`); the keyboard then goes to the composer unless something has it. The New Session welcome, a "New Session" tab, "No sessions yet" and "quota unknown" are never shown as a guess; the welcome appears only once the list says there is nothing to restore. The capsule reads "quota unknown" only after the first quota seed has answered.

## Unresolved
None.
