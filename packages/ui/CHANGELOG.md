# @qlan-ro/mainframe-ui

## 2.0.0-rc.6

### Minor Changes

- [#448](https://github.com/qlan-ro/mainframe/pull/448) [`030e4dc`](https://github.com/qlan-ro/mainframe/commit/030e4dccde96df128fcc92b8b2502318e0cd8911) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace v1 YAML workflows with Automations v2 (new /api/automations surface; /api/workflows removed).

### Patch Changes

- [#446](https://github.com/qlan-ro/mainframe/pull/446) [`aa2dce6`](https://github.com/qlan-ro/mainframe/commit/aa2dce69b38621395466777eabb5e9d0088fd17a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Style scrollbars globally instead of per-element. The warm thin scrollbar was an opt-in class covering 9 of 66 scroll containers; every other surface (markdown preview, diff viewers, workflows, tab panels, …) painted the native track — near-white under light themes and permanently visible with a mouse attached. Two @layer base rules now give every scroller the thin, hover-revealed, transparent-track treatment across all themes and schemes; [scrollbar-width:none] opt-outs still win, and the mf-thin-scrollbar class is removed.

- Updated dependencies [[`030e4dc`](https://github.com/qlan-ro/mainframe/commit/030e4dccde96df128fcc92b8b2502318e0cd8911)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.6
