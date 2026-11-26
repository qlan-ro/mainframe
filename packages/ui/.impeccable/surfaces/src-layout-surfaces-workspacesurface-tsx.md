---
version: 1
slug: "src-layout-surfaces-workspacesurface-tsx"
primary_target: "src/layout/surfaces/WorkspaceSurface.tsx"
related_targets: ["src/features/preview","src/features/workspace-chat","src/features/side-chat"]
---

# Workspace

## Scope and mode
Operate. The workspace surface beside the chat: preview, terminal, files, diff, URL, agent tabs, and every secondary chat. Canvas page "Workspace". Spec rows: W in `design/redesign/DECISIONS.md`.

## Audience and job
Look at what the agent changed or runs, without losing the conversation.

## Constraints
Tabs follow the active session's scope; chat and agent tabs follow the session itself. The chat column always holds one conversation (W9). Closing a chat tab never loses its unsent message, and never deletes the chat: discarding a side chat is a separate, confirmed action. Previews are native webviews above the DOM, so they hide while the panel slides.
What the user picks here for the agent joins the message being written: a preview capture or selected code lines become a tile in the composer (C14), and nothing is sent until the user sends it.

## Direction contract
THESIS: one surface for everything that isn't the conversation. Forked chats, side chats, delegated tasks and sub-agents open as tabs here. This retires split chats.
OWN-WORLD: tabs in the title bar's third segment, type glyphs, a fixed +, a Files toggle. The panel slides in and pushes the chat. Closing the last tab collapses it.
STORY: the user opens a preview or an agent beside the chat, follows it, and closes it when done.
FIRST VIEWPORT: chat on the left, the workspace on the right with its tabs above it in the title bar.
FORM: seed: none (pinned) "this will retire split chats, everything will open as a workspace surface tab".
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Terminal
The interactive terminal fills its pane with the workspace surface in both themes. Output and the cursor use secondary ink, with 12 px monospace and 19 px rows. The terminal grid fits inside 10 px vertical and 14 px horizontal padding and keeps its overlay scrollbar lane. Theme changes recolor the existing session and its scrollback.

## Memorable moment
An agent opened from the Activity panel arrives as a tab with its live steps. Its steps are the transcript's own rows, and its status is what its row in the transcript says (T1c, W8).

## Unresolved
None.

The Agent tab loads saved Claude steps when opened, including when opened from another saved agent. An agent waiting for permission keeps its live steps. The tab reuses pages loaded inline, shows a loading status while a request is pending, and offers Retry when a load fails or the saved pages are cleared.

Find in the saved Claude Agent tab searches the entire child transcript, including steps outside the loaded window. The Agent and Chat headers offer Markdown export, which includes saved child text.
