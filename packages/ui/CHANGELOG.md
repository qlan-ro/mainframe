# @qlan-ro/mainframe-ui

## 2.12.2

### Patch Changes

- [#864](https://github.com/qlan-ro/mainframe/pull/864) [`02a46d9`](https://github.com/qlan-ro/mainframe/commit/02a46d9a23f1535dae0a983f1c54f76b0e676a86) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Load tool-result images when they become visible instead of embedding every image in transcript replay. Preserve gallery access to original images, cache fetched pixels, and allow failed image loads to retry. Reduce Claude session warmup allocations by skipping message payloads while scanning plan and skill metadata.

- Updated dependencies [[`02a46d9`](https://github.com/qlan-ro/mainframe/commit/02a46d9a23f1535dae0a983f1c54f76b0e676a86)]:
  - @qlan-ro/mainframe-types@2.12.2
