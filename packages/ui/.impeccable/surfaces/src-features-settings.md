---
version: 1
slug: "src-features-settings"
primary_target: "src/features/settings"
related_targets: ["src/features/palette","src/features/setup-advisor","src/features/daemon"]
---

# Settings & dialogs

## Scope and mode
Operate. The settings dialog and its panes (General, Chat, Remote access and the rest), the command palette, the setup advisor and the daemon dialogs. Canvas page "Settings".

## Audience and job
Change how the app behaves once, and trust the change: say what a choice does in one sentence and show the state it is in.

## Constraints
A pane is rows of one control each, with a label and one sentence under it. A preview is marked "(preview)" in its label and is off by default; turning it off returns today's behaviour exactly.

Settings › Chat has two sections. Composer holds what Enter does while a turn runs and the preview "Mentions and commands as chips" (the composer shows `@` and `/` tokens as atomic chips). Transcript holds the number of turns loaded at a time and the preview "Plain transcript list" (every loaded message is a plain row under one scroll owner, with no virtualizer, and older pages land without moving what the reader is reading). Each preview is a toggle row; changing the plain list takes effect at once, in the open chat. The board `Settings-Chat` shows the plain list row by hand-edit until the next capture.
