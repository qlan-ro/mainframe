# @qlan-ro/mainframe-ui

## 2.0.0-rc.5

### Patch Changes

- [#443](https://github.com/qlan-ro/mainframe/pull/443) [`8189745`](https://github.com/qlan-ro/mainframe/commit/8189745d8deb596a8f9fc5480c88bb378f73ce51) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the sessions-list scrollbar and pinned group headers. The mf-thin-scrollbar class mixed the standards scrollbar properties with ::-webkit-scrollbar rules; engines that honor the standard properties ignore the webkit rules, letting the native white classic scrollbar paint on warm panels — the class now uses the standards path only (thin, transparent, thumb on hover). Pinned group headers no longer show row content through them: the scroller's top padding opened a see-through band above the sticky header, and WKWebView's backdrop-filter does not reliably blur sibling rows scrolled beneath it — the pinned host now composites the glass tint over an opaque base. Also restores the sessions-list-scroll test hook that Virtuoso's own data-testid was overriding.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.5
