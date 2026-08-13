# @qlan-ro/mainframe-ui

## 2.0.0-rc.26

### Minor Changes

- [#624](https://github.com/qlan-ro/mainframe/pull/624) [`7f1ebda`](https://github.com/qlan-ro/mainframe/commit/7f1ebdae1222011ae39226da13d99a140bba9c67) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Give session tabs a right-click menu, so the split gestures are reachable without knowing them.

  Splitting the chat surface had no discoverable entry point from the strip: ⌘-click opens a split, dragging a tab retargets one, and ⌘\ dissolves one, but a tab announced none of it. Right-clicking a tab now offers Open in Split — disabled precisely when the gesture has nowhere to go — or, on a tab already in the pair, Close Split, which dissolves it and leaves you on the session you pointed at. A parked pair dissolves without moving focus. Keep Open (on the preview tab) and Close round the menu out. The menu performs the existing gestures rather than adding new ones: the enabled state and the action now read from one shared `canOpenInSplit` predicate, so the offer can't drift from what the gesture does.

### Patch Changes

- [#629](https://github.com/qlan-ro/mainframe/pull/629) [`ce1d38d`](https://github.com/qlan-ro/mainframe/commit/ce1d38dc1408d8d70a88eed870ed24db171e71d4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop showing a padlock on providers that are installed. The boot snapshot reports every adapter as uninstalled when the CLI probe outruns the daemon's 2s cap, and the follow-up catalog event refreshed the models without clearing that flag — so a brand-new session could offer Claude's full model list while both provider tabs sat disabled. The event now carries the probe's verdict, and the client applies it.

- [#625](https://github.com/qlan-ro/mainframe/pull/625) [`f799bc5`](https://github.com/qlan-ro/mainframe/commit/f799bc50aa7896001aebef589382922717469b1a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep a new session's tab open while it is a draft, and make it temporary once it is sent.

  Creating a session used to pin its tab immediately, so every new session accumulated a permanent tab wherever the pinned set happened to end. The strip now has a third slot: an unsent draft opens into it, where opening another session cannot displace it, and the first send demotes it into the ordinary preview slot — it turns italic, grows the "Keep open" pin, and the next session you open replaces it. The draft always renders last, so a new session is the end tab. The runtime's transient boot draft is told apart from a deliberate one by whether the session list had loaded when it was activated, so booting still leaves no stray "New Session" tab.

- [#622](https://github.com/qlan-ro/mainframe/pull/622) [`5d6a0a3`](https://github.com/qlan-ro/mainframe/commit/5d6a0a31070c0783ce2cc70536ce5768682e7e10) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Light the split pair's shared tab underline only while the split is on screen.

  A split groups two session tabs under one container in the title-bar strip, and that container drew its 2px underline unconditionally. Because a pair stays open while parked behind a third session, the strip could show three tabs wearing the selected underline at once — the pair's plus the focused tab's — leaving no way to tell which session you were actually looking at. The underline now lights on exactly the terms a lone tab's does: a member of the pair is the focused session. The container's faint tint is dropped with it, so grouping reads from the two tabs sitting adjacent rather than from a mark that outlives the split it describes.

- [#626](https://github.com/qlan-ro/mainframe/pull/626) [`6722a60`](https://github.com/qlan-ro/mainframe/commit/6722a60c1e1999c5e53c10919e9b7b7f42584f7f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep scrollbar thumbs visible in Tauri webviews.

- [#627](https://github.com/qlan-ro/mainframe/pull/627) [`2077f7c`](https://github.com/qlan-ro/mainframe/commit/2077f7c2340fd01fdd2abe775d8a345c4afc4f9e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Return the transcript to its newest message when you switch sessions. Every session shares one scrolling viewport, so reading back in one session left every session opened after it parked at that same offset, mid-history.

- [#628](https://github.com/qlan-ro/mainframe/pull/628) [`d1023b0`](https://github.com/qlan-ro/mainframe/commit/d1023b04856eb740f7395dbf377c7edbeceaabb6) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Prevent release Tauri webviews from rubber-banding the app shell when scrolling past a transcript boundary.

- [#621](https://github.com/qlan-ro/mainframe/pull/621) [`a49f893`](https://github.com/qlan-ro/mainframe/commit/a49f893e60d934b621488f6f9b9aa58fdeaa9df2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Shrink the update pill so it fits the title-bar row it lives in.

  "Install update — v2.0.0-rc.25 is available" measured 249px in a slot that is under 100px wide at the default sidebar width, and it rendered in bold primary — the loudest thing in otherwise muted chrome. The pill now reads Update / 47% / Restart, carries the version and the next step in its hint, and is built on the `Badge` primitive it used to hand-roll, so it inherits the focus ring and the 12px icon.

- Updated dependencies [[`ce1d38d`](https://github.com/qlan-ro/mainframe/commit/ce1d38dc1408d8d70a88eed870ed24db171e71d4)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.26
