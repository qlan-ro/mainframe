# @qlan-ro/mainframe-ui

## 2.3.1

### Patch Changes

- [#693](https://github.com/qlan-ro/mainframe/pull/693) [`e1bb693`](https://github.com/qlan-ro/mainframe/commit/e1bb693cef9c180e802f2df107e11f81f6ddcd6f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - A turn that alternates prose and tool calls reads in the order it happened again. Since the ACP facade landed, every paragraph of an assistant turn was folded into one block at the top of the message and all of its tool calls were stacked underneath, so a reply that explained a step, ran it, explained the next one, and ran that arrived as one wall of text followed by twenty terminal cards — and the paragraphs on either side of a tool call were glued together without even a space between them. The encoder now closes a run of text when a tool call, a subagent task, or a thinking block interrupts it, and resumes the text as a new item after it, which is what the renderer was always ready to draw.

- Updated dependencies [[`e1bb693`](https://github.com/qlan-ro/mainframe/commit/e1bb693cef9c180e802f2df107e11f81f6ddcd6f)]:
  - @qlan-ro/mainframe-types@2.3.1
