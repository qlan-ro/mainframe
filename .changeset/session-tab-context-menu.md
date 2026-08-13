---
'@qlan-ro/mainframe-ui': minor
---

Give session tabs a right-click menu, so the split gestures are reachable without knowing them.

Splitting the chat surface had no discoverable entry point from the strip: ⌘-click opens a split, dragging a tab retargets one, and ⌘\ dissolves one, but a tab announced none of it. Right-clicking a tab now offers Open in Split — disabled precisely when the gesture has nowhere to go — or, on a tab already in the pair, Close Split, which dissolves it and leaves you on the session you pointed at. A parked pair dissolves without moving focus. Keep Open (on the preview tab) and Close round the menu out. The menu performs the existing gestures rather than adding new ones: the enabled state and the action now read from one shared `canOpenInSplit` predicate, so the offer can't drift from what the gesture does.
