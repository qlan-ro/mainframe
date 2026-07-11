---
"@qlan-ro/mainframe-ui": patch
---

Fix the sessions-list scrollbar and pinned group headers. The mf-thin-scrollbar class mixed the standards scrollbar properties with ::-webkit-scrollbar rules; engines that honor the standard properties ignore the webkit rules, letting the native white classic scrollbar paint on warm panels — the class now uses the standards path only (thin, transparent, thumb on hover). Pinned group headers no longer show row content through them: the scroller's top padding opened a see-through band above the sticky header, and WKWebView's backdrop-filter does not reliably blur sibling rows scrolled beneath it — the pinned host now composites the glass tint over an opaque base. Also restores the sessions-list-scroll test hook that Virtuoso's own data-testid was overriding.
