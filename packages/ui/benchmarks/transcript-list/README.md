# Transcript list proof rig

A browser rig for the transcript's scroll behaviour: properties P1–P7 from the architecture review's proof spec (part 2, section 4.5), measured on four list variants in Chromium, in the system WebKit through a plain `WKWebView` (the engine of Safari 27 and the app's webview), and in Playwright's WebKit build. It decides #461 and stays as the scroll regression gate. The report is [`docs/research/2026-11-26-transcript-list-rig.md`](../../../../docs/research/2026-11-26-transcript-list-rig.md).

No app, daemon, or provider is involved, and nothing in `src/` changes. The page mounts the real `TurnTranscript` and everything under it on a synthetic chat. A Vite plugin redirects two imports inside the transcript so the list around the rows can change: `thread/VirtualMessages` goes to `lists/list-switch.tsx`, and `messages/turn/use-row-anchor` goes to `lists/row-anchor-switch.ts`.

## Variants (`?v=`)

| Variant | List | Scroll owner | Browser anchoring |
| --- | --- | --- | --- |
| `v0` | Today: react-virtuoso inside assistant-ui's viewport, composer sticky inside the scroller | Bottom pin, prepend anchor, row anchor, Virtuoso, assistant-ui | Off |
| `v1` | Plain rows, composer below the scroller | `shells/scroll-owner.ts` (follow in the resize callback, release on reader input, one measured restore at offset 0) | On |
| `v1s` | Plain rows as `MessageScroller.Item`s | shadcn Message Scroller, `@shadcn/react` 0.3.1 | On (the library relies on it) |
| `v2` | LegendList 3.7.2, one row per message (the fixture cuts a turn into messages of one or two parts) | LegendList | n/a (it positions rows itself) |

Other parameters: `groups` (turns in the window, default 40), `total` (turns in the chat, default `groups + 120`), `hold=<turn>` (the server holds that turn's image until released), `live=1` (the newest turn is still running), `manual=1` (P7 by hand), `progressive=1` (v1 mounts the newest six rows, then prepends the rest of the window twelve rows per task), `cv=1` (`content-visibility: auto` on every row). The driver writes these as variants: `v1+progressive`, `v1+cv`.

## Fixture

`fixture.ts` builds turns shaped like a Claude chat: a prompt, then assistant messages with a 100-line Read, Bash, Grep, Edit, a nested Task agent every fourth turn, and an answer with prose, a 30-line code block, an 8-row table and, every seventh turn, a remote image that loads 150–630 ms late. Every third turn is opened with its Read output showing. The loaded window starts inside a turn, the way a page of "40 groups or 80 items" can end mid-group. A page is the messages before the window back to 80 items.

## Running

From the repository root, after `pnpm install`, `pnpm --filter @qlan-ro/mainframe-types build`, and `pnpm --filter @qlan-ro/mainframe-e2e exec playwright install chromium webkit`:

```sh
node packages/ui/benchmarks/transcript-list/driver/run.mjs --engines chromium,wk,webkit --repeat 2 --out results.json
node packages/ui/benchmarks/transcript-list/driver/summarize.mjs results.json
```

`--variants v1,v1s` and `--cases P3,P4` narrow a run (prefix match). `--synthetic` replaces native wheel input with dispatched events. The bundle uses React's profiling build so `<Profiler>` can time each chunk; `RIG_PROFILE=0` builds with plain `react-dom` for mount times comparable with the app. `--serve` builds, serves the page on `--port` (default 5199) and waits, for runs by hand. The `wk` engine compiles `driver/wkrig.swift` with `swiftc` and opens a 1280×720 web view in a borderless window at the bottom-left of the screen. It uses a non-persistent data store and never touches the app or its storage.

## Measurement

`probe.ts` marks the block under the viewport (40% down) as the reader's anchor and takes one sample per frame: the anchor's offset from the viewport top and the gap to the bottom. The sample is taken in a ResizeObserver callback that a probe element triggers every frame. That runs after layout, scroll anchoring, and the list's own observers, just before paint. A sample taken in `requestAnimationFrame` would read layout before those run, a state the screen never shows.

Scroll input goes through the engine's own wheel path: Playwright's mouse in Chromium and Playwright WebKit, and real `NSEvent` scroll-wheel events sent to the web view in `WKWebView`. Only the harness can send a trackpad flick with momentum phases, which the P7 proxy uses.

| Case | What it does | Pass line |
| --- | --- | --- |
| P1-middle, P1-top | A page lands above a reader parked mid-history, or at offset 0 | Drift ≤ 1 px for 2 s |
| P2-control, P2-page | 20 wheel events of −100 px, with and without a page landing after the eighth | Same end ±2 px, nothing moves against the wheel by more than 2 px |
| P3-{image,code,fold}-{up,down} | A held image (+160 px), a code block (+12 lines), or the newest turn folding at its end, 150–250 px above the viewport, reached by scrolling up or down | Drift ≤ 1 px for 2 s |
| P4-follow | 10 s at 30 chunks/s with a row every 250 ms, then the run ends and its work folds | Bottom gap ≤ 1 px, measured from the first frame at the live edge after the send |
| P4-wheel-up, P4-wheel-down | A 120 px wheel while following, then the jump button | Up: follow stops and stays stopped, the jump lands in ≤ 2 frames. Down: still following |
| P5-open | Five opens at 40 groups | The first frame with rows is at the end: last row in view, gap ≤ 1 px, no hidden frames |
| P6-open-N, P6-scroll-400, P6-stream-400 | Mount to the first frame showing the last row; 30 px per frame scripted scroll at 400 groups; chunk commit (store write to the first DOM mutation) | Mount within 15 ms of v0 at 40 groups; ≥ 50 fps; chunk p95 ≤ 8 ms |
| P7-flicks (WKWebView only) | Momentum flicks up through page loads | Proxy only: anchoring held, main-thread stall, largest single-frame step |

P7 itself needs hands: open `?v=v1&manual=1` in Safari with `--serve` running, flick up through five page loads three times, and read the steps in the readout.
