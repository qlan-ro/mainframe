# @qlan-ro/mainframe-ui

## 2.0.0-rc.28

### Minor Changes

- [#657](https://github.com/qlan-ro/mainframe/pull/657) [`cec67c4`](https://github.com/qlan-ro/mainframe/commit/cec67c4234d02f09996e707b9932a450d46570d8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The Workspace surface's Files panel is now a persistent docked sidebar on the right edge instead of a floating overlay — it resizes the content pane rather than covering it, and stays open across file picks. Its open state persists per project/worktree, and it closes only via its own toggle (no more light-dismiss on Escape or an outside click). The trigger icon changed from a folder glyph to `PanelRight`, mirroring the left sidebar's static `PanelLeftIcon`.

- [#635](https://github.com/qlan-ro/mainframe/pull/635) [`012e0b0`](https://github.com/qlan-ro/mainframe/commit/012e0b0d05cb7350935a0693c27a47a54b549794) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rebind any keyboard shortcut in Settings → Keybindings. Recording a chord another action holds offers to take it, and the loser is left unassigned rather than silently sharing the key.

- [#635](https://github.com/qlan-ro/mainframe/pull/635) [`012e0b0`](https://github.com/qlan-ro/mainframe/commit/012e0b0d05cb7350935a0693c27a47a54b549794) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace the nine independent keydown listeners with one declarative shortcut registry and a single dispatcher, add the session-tab (⌃1…⌃9, ⌃Tab/⌃⇧Tab), open-in-split (⌘⇧\\), focus-composer (⌘L) and cheat-sheet (⌘/) bindings the app lacked, and ship a read-only cheat sheet (also reachable from the command palette) that renders every declared shortcut.

### Patch Changes

- [#635](https://github.com/qlan-ro/mainframe/pull/635) [`012e0b0`](https://github.com/qlan-ro/mainframe/commit/012e0b0d05cb7350935a0693c27a47a54b549794) Thanks [@doruchiulan](https://github.com/doruchiulan)! - ⌘T opens a blank browser tab in the workspace, ready for an address.

- [#650](https://github.com/qlan-ro/mainframe/pull/650) [`3563760`](https://github.com/qlan-ro/mainframe/commit/35637600af77f33c530621ca7335384208bf0137) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Softened the user message bubble's fill (`--bubble-tinted`) to a paler, less
  saturated tint in both themes — closer to a soft near-white blue than the
  previous saturated periwinkle. Contrast against body ink still clears WCAG
  4.5:1 by a wide margin in both themes.

- [#635](https://github.com/qlan-ro/mainframe/pull/635) [`012e0b0`](https://github.com/qlan-ro/mainframe/commit/012e0b0d05cb7350935a0693c27a47a54b549794) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The command palette moves to ⌘K, the gesture it shares with every other spotlight. ⌘O goes back to meaning "open a file".

- [#648](https://github.com/qlan-ro/mainframe/pull/648) [`e353dcf`](https://github.com/qlan-ro/mainframe/commit/e353dcf4529ef28c74a6011ede03346d92703faa) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix a project added from the empty first-run state never appearing until a full reload. `useProjects()` moved from a per-caller `useState` to a shared `store/projects.ts` store, so a reload issued from one mounted consumer (e.g. the "Add project" CTA) now updates every other one — the sidebar and chat surface included.

- [#635](https://github.com/qlan-ro/mainframe/pull/635) [`012e0b0`](https://github.com/qlan-ro/mainframe/commit/012e0b0d05cb7350935a0693c27a47a54b549794) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Switch sessions with ⌘1…⌘9, and hold ⌘ to see which number opens which tab. The strip and the sidebar both show the key, so ⌘4 stops being a guess. The Chat and Workspace surfaces move to ⌘⇧C and ⌘⇧W to free the digits.

- [#635](https://github.com/qlan-ro/mainframe/pull/635) [`012e0b0`](https://github.com/qlan-ro/mainframe/commit/012e0b0d05cb7350935a0693c27a47a54b549794) Thanks [@doruchiulan](https://github.com/doruchiulan)! - ⌘J opens a terminal in the workspace, revealing the surface if it was hidden.

- [#649](https://github.com/qlan-ro/mainframe/pull/649) [`ffa0020`](https://github.com/qlan-ro/mainframe/commit/ffa00201b9be4d794f17571f3ddce5fefb57dce3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fixed the first-run tutorial popover clipping off the right edge of the
  viewport on step 4 ("Open the workspace"), whose anchor sits near the right
  edge of the toolbar. The label card's horizontal position is now clamped
  against both viewport edges, not just the left.
- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.28
