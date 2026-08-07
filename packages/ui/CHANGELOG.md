# @qlan-ro/mainframe-ui

## 2.0.0-rc.19

### Minor Changes

- [#567](https://github.com/qlan-ro/mainframe/pull/567) [`316adb2`](https://github.com/qlan-ro/mainframe/commit/316adb2bf2d2f81dac20eed21e09139485d00d0a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace the inspector's Changes tab and the Context/Skills/Agents bottom panel with a session panel inside the chat surface: collapsible Summary, Plan, Background Activity, Launch and Context sections on a translucent glass card. The panel floats in the whitespace beside the centred transcript and never takes width from it. It collapses to a quick-action icon rail (panel, background activity, context usage, run) when the gutter is too short for it or on demand, and a rail click brings it back — inline where there is room, floating over the transcript where there isn't. The collapse and the open sections persist across sessions. Background activity moves out of the composer footer, launch controls move off the toolbar into the rail and Launch section, the chat header's context meter is gone, and the review modal gains a Session/Uncommitted/Branch scope switcher.

### Patch Changes

- [#568](https://github.com/qlan-ro/mainframe/pull/568) [`2288da2`](https://github.com/qlan-ro/mainframe/commit/2288da227cdcf7ee34830ca6d4b447809c778a5c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Adopt two treatments from assistant-ui's element registry. A long run now shows how long it has been going: the chat thread's working indicator gains a pulse dot and a live elapsed readout beside the rotating phrase. The session panel's Background Activity rows take the same pulse dot in place of their spinner, so working reads identically wherever it appears.

- [#567](https://github.com/qlan-ro/mainframe/pull/567) [`316adb2`](https://github.com/qlan-ro/mainframe/commit/316adb2bf2d2f81dac20eed21e09139485d00d0a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the preview-capture card in user messages: the CSS-selector breadcrumb overflowed the card and ran off the panel edge, and its tooltip could never open.

- [#565](https://github.com/qlan-ro/mainframe/pull/565) [`980a5fc`](https://github.com/qlan-ro/mainframe/commit/980a5fc17be65018b70c213866c9464c28568cc9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rebase the v2 UI clone on the stock shadcn Luma preset. The custom token layer — named type rungs, compressed spacing, `mf-*` colours, three colour schemes, three window styles — is gone; v2 now renders on the preset's sheet with the macOS system blue as `--primary`.

- [#565](https://github.com/qlan-ro/mainframe/pull/565) [`980a5fc`](https://github.com/qlan-ro/mainframe/commit/980a5fc17be65018b70c213866c9464c28568cc9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Switch the v2 UI clone from the `radix-luma` style to `radix-vega`. Luma's pill geometry was too round for this app; vega squares the controls, tightens the sidebar rows and returns inputs to outlined fields. The token sheet is unchanged — the two styles ship identical stylesheets.
