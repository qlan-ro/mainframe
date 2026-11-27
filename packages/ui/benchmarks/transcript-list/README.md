# Transcript list proof rig

A browser rig for the transcript's scroll behaviour: properties P1–P7 from the architecture review's proof spec (part 2, section 4.5), measured on four list variants in Chromium, in the system WebKit through a plain `WKWebView` (the engine of Safari 27 and the app's webview), and in Playwright's WebKit build. It decides #461 and stays as the scroll regression gate. The report is [`docs/research/2026-11-26-transcript-list-rig.md`](../../../../docs/research/2026-11-26-transcript-list-rig.md).

No app, daemon, or provider is involved, and nothing in `src/` changes. The page mounts the real `TurnTranscript` and everything under it on a synthetic chat. A Vite plugin redirects two imports inside the transcript so the list around the rows can change: `thread/VirtualMessages` goes to `lists/list-switch.tsx`, and `messages/turn/use-row-anchor` goes to `lists/row-anchor-switch.ts`.

## Variants (`?v=`)

| Variant | List | Scroll owner | Browser anchoring |
| --- | --- | --- | --- |
| `v0` | Today: react-virtuoso inside assistant-ui's viewport, composer sticky inside the scroller | Bottom pin, prepend anchor, row anchor, Virtuoso, assistant-ui | Off |
| `v1` | Plain rows, composer below the scroller | `shells/scroll-owner.ts` (follow in the resize callback, release on reader input, one measured restore at offset 0) | On |
| `v1s` | Plain rows as `MessageScroller.Item`s | shadcn Message Scroller, `@shadcn/react` 0.3.1 | On (the library relies on it) |
| `v1s-patched` | The same, from the vendored copy in `vendor/` (MIT, see its `LICENSE.md`) with two marked patches: only an upward wheel releases follow, and follow runs inside the ResizeObserver callback | shadcn Message Scroller, patched | On |
| `v1+fix`      | As `v1`, with the short-window fix in `shells/scroll-owner.ts` (`?fix=1`)                                                                                                                   | As `v1`, plus: when a page is about to land and the reader is not following, take over the landing: anchoring off for it, shift `scrollTop` by how far the reader's block moved in the content | Off for the landing, on otherwise |
| `v2` | LegendList 3.7.2, one row per message (the fixture cuts a turn into messages of one or two parts) | LegendList | n/a (it positions rows itself) |

Other parameters: `groups` (turns in the window, default 40), `total` (turns in the chat, default `groups + 120`), `hold=<turn>` (the server holds that turn's image until released), `live=1` (the newest turn is still running), `manual=1` (P7 by hand), `progressive=1` (v1 mounts the newest six rows, then prepends the rest of the window twelve rows per task), `cv=1` (`content-visibility: auto` on every row), `nopreserve=1` (v1s: `preserveScrollOnPrepend={false}`; the library then reads a prepend as a new turn and scrolls to it). The driver writes these as variants: `v1+progressive`, `v1+cv`, `v1s+nopreserve`; `progressive` works on `v1`, `v1s` and `v1s-patched`.

## Fixture

`fixture.ts` builds turns shaped like a Claude chat: a prompt, then assistant messages with a 100-line Read, Bash, Grep, Edit, a nested Task agent every fourth turn, and an answer with prose, a 30-line code block, an 8-row table and, every seventh turn, a remote image that loads 150–630 ms late. Every third turn is opened with its Read output showing. The loaded window starts inside a turn, the way a page of "40 groups or 80 items" can end mid-group. A page is the messages before the window back to 80 items.

## Running

From the repository root, after `pnpm install`, `pnpm --filter @qlan-ro/mainframe-types build`, and `pnpm --filter @qlan-ro/mainframe-e2e exec playwright install chromium webkit`:

```sh
node packages/ui/benchmarks/transcript-list/driver/run.mjs --engines chromium,wk,webkit --repeat 2 --out results.json
node packages/ui/benchmarks/transcript-list/driver/summarize.mjs results.json
```

`--variants v1,v1s` and `--cases P3,P4` narrow a run (prefix match). `--synthetic` replaces native wheel input with dispatched events. `--tag pre980` labels every variant `v0@pre980`, to compare two builds of the page in one comparison.

**React build.** The bundle uses React's profiling build by default, so `<Profiler>` can time each chunk (the P6 chunk row needs it). `RIG_PROFILE=0 node .../run.mjs ...` builds with plain `react-dom`, whose mount times are comparable with the app. Every record carries its build in `react`, and `summarize.mjs` heads each table with it. Profiling and plain numbers are never mixed in one table.

**Results.** `results/` holds the raw JSON behind the report's tables. It has no machine paths (`run.mjs` scrubs them) and records the load average of the run. `--serve` builds, serves the page on `--port` (default 5199) and waits, for runs by hand. The `wk` engine compiles `driver/wkrig.swift` with `swiftc` and opens a 1280×720 web view in a borderless window at the bottom-left of the screen. It uses a non-persistent data store and never touches the app or its storage.

## Measurement

`probe.ts` marks the block under the viewport (40% down) as the reader's anchor and takes one sample per frame: the anchor's offset from the viewport top and the gap to the bottom. The sample is taken in a ResizeObserver callback that a probe element triggers every frame. That runs after layout, scroll anchoring, and the list's own observers, just before paint. A sample taken in `requestAnimationFrame` would read layout before those run, a state the screen never shows.

Scroll input goes through the engine's own wheel path: Playwright's mouse in Chromium and Playwright WebKit, and real `NSEvent` scroll-wheel events sent to the web view in `WKWebView`. Only the harness can send a trackpad flick with momentum phases, which the P7 proxy uses.

| Case | What it does | Pass line |
| --- | --- | --- |
| P1-middle, P1-top | A page lands above a reader parked mid-history, or at offset 0 (the run records where `park()` left the reader; P1-top fails unless that is 0) | Drift ≤ 1 px for 2 s |
| P2-control, P2-page | 20 wheel events of −100 px, with and without a page landing after the eighth | Same end ±2 px as the control, and neither run moves against the wheel by more than 2 px (a jump the control shows too is a plain-wheel jump, not the page) |
| P3-{image,code,fold}-{up,down} | A held image (+160 px), a code block (+12 lines), or the newest turn folding at its end, 150–250 px above the viewport, reached by scrolling up or down | Drift ≤ 1 px for 2 s |
| P4-follow | 10 s at 30 chunks/s with a row every 250 ms, then the run ends and its work folds | Bottom gap ≤ 1 px, measured from the first frame at the live edge after the send. A run that never reaches the live edge fails |
| P4-wheel-up, P4-wheel-down | A 120 px wheel while following, then the jump button | Up: follow stops and stays stopped, the jump lands in ≤ 2 frames. Down: still following |
| P5-open | Five opens at 40 groups | The first frame whose rows are really visible (`checkVisibility`, not `visibility: hidden`) is at the end: last row in view, gap ≤ 1 px. Hidden frames (rows in the DOM, none visible), the time to the first visible frame and the time to the tail are recorded |
| P6-open-N, P6-scroll-400, P6-stream-400 | Mount to the first frame showing the last row; 30 px per frame scripted scroll at 400 groups; chunk commit (store write to the first DOM mutation) | Mount within 15 ms of v0 at 40 groups; ≥ 50 fps; chunk p95 ≤ 8 ms |
| P6-tail, P6-tail-400 (`+progressive` variants) | Tail-first mount scored to completion: the time the whole window is in, and the longest main-thread gap per slice (a MessageChannel loop, so it works in every engine) | Report only |
| E-P1 to E-P4 (`+progressive` variants) | The same cases, started as soon as rows exist, with no settle wait, so slices are still landing. P2 scores only the movement against the wheel (the park position is not comparable while the height grows) | As P1 to P4 |
| S-top-{,park-,real-}{60,300,flick}             | A short first window (`window=2` from the tail or parked at 0, or `shape=real`: the measured shape of a real first window, two folded tool-heavy turns, about one viewport, 80-item pages). The reader wheels up continuously (−60 px or −300 px steps, or two momentum flicks in WKWebView) and each older page lands 60 ms ±30% after the app's gesture rule requests it. Scored per landing | After removing the wheel's own deltas, the anchor moves ≤ 2 px (flicks: ≤ the ledger's noise floor); the anchor is never lost; the reader is not left at the top of the new page (`pinned`). `loads` is recorded: repeated loads without the reader moving away from the top are a failure signal |
| S-noise-{60,300,flick}                         | The same input with no page landing, scored the same way                                                                                                                                                                                                                                                                                                                                       | The ledger's own error, the floor a flick's S-top residual is read against                                                                                                                                                                                                                        |
| P7-flicks (WKWebView only) | Momentum flicks up through page loads | Proxy only: anchoring held, main-thread stall, largest single-frame step |

**S-top scoring.** The anchor is the block under the viewport centre when the page is requested. The baseline is the last frame before the landing shows. The wheel's own movement comes from a ledger of the page's `wheel` events: the expected offset is the baseline plus the net travel, where events applied before the page lands stop at the old top and later ones at the top of the new page. A wheel event and the frame that shows its scroll can be a few frames apart and the lag differs per event, so the model is a prefix (the browser has applied the first `m` events, `m` within a window of frames) and the best fit is scored; this forgives a jump no larger than the wheel step in flight. An anchor that leaves the viewport stays a number; an unmounted one counts as lost, never as a missing sample. The distance to the bottom is scored the same way, for a virtualizer that unmounts the anchor.

P7 itself needs hands: open `?v=v1&manual=1` in Safari with `--serve` running, flick up through five page loads three times, and read the steps in the readout.
