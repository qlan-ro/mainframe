---
version: 1
slug: "src-layout-surfaces-workspacesurface-tsx"
primary_target: "src/layout/surfaces/WorkspaceSurface.tsx"
related_targets: ["src/features/preview","src/features/side-chat"]
---

# Workspace

## Scope and mode
Operate. The workspace surface beside the chat: preview, terminal, files, diff, URL, agent tabs, and every secondary chat. Canvas page "Workspace". Spec rows: W in `design/redesign/DECISIONS.md`.

## Audience and job
Look at what the agent changed or runs, without losing the conversation.

## Constraints
Tabs follow the active session's scope. The chat column always holds one conversation (W9).

## Direction contract
THESIS: one surface for everything that isn't the conversation. Forked chats, side chats, delegated tasks and sub-agents open as tabs here. This retires split chats.
OWN-WORLD: tabs in the title bar's third segment, type glyphs, a fixed +, a Files toggle. The panel slides in and pushes the chat. Closing the last tab collapses it.
STORY: the user opens a preview or an agent beside the chat, follows it, and closes it when done.
FIRST VIEWPORT: chat on the left, the workspace on the right with its tabs above it in the title bar.
FORM: seed: none (pinned) "this will retire split chats, everything will open as a workspace surface tab".
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment
An agent opened from the Activity panel arrives as a tab with its live steps.

## Unresolved
None.
