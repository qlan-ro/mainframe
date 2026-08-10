# @qlan-ro/mainframe-ui

## 2.0.0-rc.22

### Patch Changes

- [#591](https://github.com/qlan-ro/mainframe/pull/591) [`e2ed4bf`](https://github.com/qlan-ro/mainframe/commit/e2ed4bf33603fb378106cf9d4652551ffe6f0920) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Center the vertical hairline dividers in the composer, main toolbar and viewer toolbars. They rendered pinned to the top of their row, sitting visibly above the icons they separate.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.22

## 2.0.0-rc.21

### Minor Changes

- [#573](https://github.com/qlan-ro/mainframe/pull/573) [`181bff0`](https://github.com/qlan-ro/mainframe/commit/181bff09a3e96560a128df3bc43c0a1dbef2851f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session tabs, toolbar identity rework, and the workspace Files sidebar. Chrome-style session tabs live in the title bar (the active session is the focused tab); the toolbar's left identity section is gone and the branch manager is a compact chip in the right control cluster; the Files tree moves inside the workspace surface as a floating panel opened from the strip's Files button (the app-level Inspector pane is removed); the chat surface header grip now repositions the surface like the workspace grip does.

### Patch Changes

- [#586](https://github.com/qlan-ro/mainframe/pull/586) [`6275932`](https://github.com/qlan-ro/mainframe/commit/6275932c03fdac43301363122dfbcb945951abf4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex sessions now receive image attachments. The daemon writes every image attachment to the chat's files
  directory and hands Codex the resulting path; when an image can't be delivered, the turn still sends and the
  transcript says how many images were dropped and why.

- [#580](https://github.com/qlan-ro/mainframe/pull/580) [`527f906`](https://github.com/qlan-ro/mainframe/commit/527f9068f291f64a6453f0f4b141b8994cb368d1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix: a Codex chat with no model chosen could not send a message at all — the turn-start request omitted the required model field, and Codex rejected it with a raw protocol error. Codex turns now always name a model, falling back to the one the Codex app-server itself resolved and then to the configured default, and say so plainly if no model can be found.

- [#582](https://github.com/qlan-ro/mainframe/pull/582) [`faa4676`](https://github.com/qlan-ro/mainframe/commit/faa46762880b5da4f3bd77258972cc50c6553cc9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The composer loads its skills and agents independently, so a failing skills fetch no longer empties the `@` agents picker and a failing agents fetch no longer empties the `/` skills picker.

- [#587](https://github.com/qlan-ro/mainframe/pull/587) [`ed219f7`](https://github.com/qlan-ro/mainframe/commit/ed219f779e4d7cf9fced0792cbf82e117cbb8ec3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The daemon pairing code input no longer leaves setState timers running after it unmounts.

- [#581](https://github.com/qlan-ro/mainframe/pull/581) [`034ac5f`](https://github.com/qlan-ro/mainframe/commit/034ac5f147bd0327edc63db4d8d04c98244a3fd8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The composer's `@` and `/` suggestion list floats above the thread instead of growing the composer.

- [#572](https://github.com/qlan-ro/mainframe/pull/572) [`373f085`](https://github.com/qlan-ro/mainframe/commit/373f085472643632c3ed01e9f0ffcef4de32fb61) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the session panel never appearing in packaged builds: the panel's width measurement ran once before the chat surface's initializing branch gave way to the real layout row, so the observer never attached and the panel stayed permanently hidden. The host is now a state-backed callback ref that re-measures whenever the row mounts. Dev servers booted fast enough to always win that race, which is why it only ever reproduced in release builds.

- [#583](https://github.com/qlan-ro/mainframe/pull/583) [`f2a9d0b`](https://github.com/qlan-ro/mainframe/commit/f2a9d0bb2891d766f5db603c8c47e4f7c7c50f52) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix remote daemons paired over plain http: the paired scheme is now persisted and honored everywhere the endpoint is rebuilt, so an http remote connects instead of silently becoming unreachable. Plain http is refused at pairing time for any host other than loopback, with a clear explanation before a pairing code is spent.

- [#584](https://github.com/qlan-ro/mainframe/pull/584) [`3f63f15`](https://github.com/qlan-ro/mainframe/commit/3f63f157ffc966af0e3c0e805252beb5c5e24e1f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The composer's @ button opens the mention picker instead of sending the message.

- [#585](https://github.com/qlan-ro/mainframe/pull/585) [`7176cca`](https://github.com/qlan-ro/mainframe/commit/7176ccaccfd3d9edd0d553f755f83630b286559d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add the `ultra` reasoning-effort level so the composer can offer and persist it.

- Updated dependencies [[`feebc74`](https://github.com/qlan-ro/mainframe/commit/feebc74c25681719d71d9eb7ecf99768735d92c8), [`f2a9d0b`](https://github.com/qlan-ro/mainframe/commit/f2a9d0bb2891d766f5db603c8c47e4f7c7c50f52), [`7176cca`](https://github.com/qlan-ro/mainframe/commit/7176ccaccfd3d9edd0d553f755f83630b286559d)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.21
