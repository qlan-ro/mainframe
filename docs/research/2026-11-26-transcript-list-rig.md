# Transcript list proof rig: P1–P7 in Chromium and WebKit (26 November 2026)

Todo #455. It decides which path #461 takes. The proof spec is section 4.5 of the architecture review's part 2, which is kept outside the repository. The rig is [`packages/ui/benchmarks/transcript-list/`](../../packages/ui/benchmarks/transcript-list/README.md). Everything here was measured at `origin/main` 54576053 (`@assistant-ui/react` 0.15.38, react-virtuoso 4.18.24, React 19.3.1) on a synthetic chat. No app, daemon, or real transcript was involved.

## 1. Short answer

**#461 takes the primary path: `v1`, no virtualizer, with the hand-written owner. It also needs two changes the spec did not have: mount the tail first, and bound the window.**

- **`v1` passes P1 to P5 in Chromium, in WKWebView (the system WebKit that Safari 27 and the app use) and in Playwright WebKit**, two repetitions each. That covers a page landing above a parked reader, a page landing mid-wheel, an image, a code block and the automatic fold above the reader in both scroll directions, following at a 0 px gap through 10 s of streaming and a 4,000 px fold, release and jump, and opening at the tail on the first frame. Browser anchoring did the work in every case. No row anchor and no settle loop were involved.
- **It fails P6 as specified.** Mounting all 40 groups takes 249 ms in Chromium and 297 ms in WKWebView, against v0's 128 and 70. The decision rule's first remedy, `content-visibility: auto`, is ruled out: it breaks WebKit's anchoring (a 347 px drift at offset 0, and 1,440–1,770 px on the fold) and saves only 25–40 ms.
- **Mounting the tail first fixes the mount.** With the newest six rows mounted first and the rest of the window prepended twelve rows per task, the first frame is at the end in 75 ms in Chromium and 49 ms in WKWebView, faster than v0. P1 to P5 still pass on both engines.
- **400 groups unvirtualized is not viable**, so the bounded window (#462) is required. It takes 1.8–3.0 s to mount, and a streamed chunk costs 90–200 ms of main-thread time, so the stream fell behind (26–50 of 150 chunks committed). At 40 groups the chunk cost matches v0.
- **`v1s` (shadcn Message Scroller) fails where `v1` passes, so the decision rule picks `v1`.**
  - P4: following lags a frame at every new row (gap spikes of 48–87 px), and a downward wheel releases follow.
  - P2 in WKWebView: the reader ends 200 px short of where the wheel put them.
  - A page landing at offset 0: a 42 px drift.
- **`v2` (LegendList) is not needed.** It is the cheapest variant: it mounts faster than v0, and its chunk cost is under 8 ms at 400 groups in Chromium. But it drifts 42 px at offset 0 and 228 px on a code block above the reader in WebKit. It stays the fallback if a bounded `v1` window misses P6 in the real app.
- **P7 (trackpad momentum by hand) was not run; it needs the owner's hands.** A synthesized-momentum proxy in WKWebView showed anchoring held through every page load for `v1` and `v1s`. It also showed a 180–216 ms main-thread stall each time a 51-message page mounts unvirtualized, after which the main thread catches up with WebKit's threaded scroll in one 630–930 px step. Whether that step is visible is the open question for the manual run.

## 2. Verdict table

A cell is the worst of two repetitions. Mount times are medians of five opens (three at 400 groups).

- **"Lost"** means the virtualizer unmounted the reader's anchor row, so the anchor could not be followed. That counts as a failure; where the reader's position could still be measured, they ended 42–43 px off.
- **Extra cases:** "P1 at offset 0" and "P4 wheel down" go beyond the spec's lines.
- **P5** is stricter than the spec's wording: the first frame with rows must be at the end (gap ≤ 1 px), not merely show part of the last row.
- **P6 chunk** is React's render time per chunk (`<Profiler>`). "Latency" is the time from the store write to the first DOM mutation, which includes up to a frame of the runtime's batching.

#### Chromium

| Property | v0 | v1 | v1s | v2 |
| --- | --- | --- | --- | --- |
| P1 | pass 0 px | pass 0.2 px | pass 0.2 px | pass 0.4 px |
| P1 at offset 0 | **fail** anchor lost | pass 0.2 px | **fail** 41.8 px | **fail** 42 px |
| P2 | pass end 0 px, against 0 px | pass end 0.2 px, against 0.2 px | pass end 0.2 px, against 0.2 px | pass end 0.3 px, against 0.3 px |
| P3 | **fail** img 160/160, code 228/0, fold 344.8/690.7 (up/down) | pass img 0/0, code 0/0, fold 0.3/0.3 (up/down) | pass img 0/0, code 0/0, fold 0.3/0.3 (up/down) | pass img 0/0, code 0/0, fold 0.5/0 (up/down) |
| P4 | **fail** gap 440 px, wheel-up releases, jump 1 fr, then gap 128 px | pass gap 0 px, wheel-up releases, jump 1 fr, then gap 0 px | **fail** gap 66 px, wheel-up releases, jump 1 fr, then gap 66 px | pass gap 0 px, wheel-up releases, jump 1 fr, then gap 0 px |
| P4 wheel down while following | **fail** releases follow | pass keeps following | **fail** releases follow | pass keeps following |
| P5 | **fail** first frame 2056 px short of the end, 1 hidden fr | pass at the end on the first frame | pass at the end on the first frame | pass at the end on the first frame |
| P6 mount 40 | pass 127.8 ms (v0 127.8) | **fail** 248.6 ms (v0 127.8) | **fail** 246.3 ms (v0 127.8) | pass 83.2 ms (v0 127.8) |
| P6 scroll 400 | pass 60 fps, p95 frame 16.8 ms | pass 51.6 fps, p95 frame 33.4 ms | pass 50.6 fps, p95 frame 33.4 ms | pass 60 fps, p95 frame 16.7 ms |
| P6 chunk p95 | **fail** render 6.3 / 8.1 ms, latency 16.4 / 16.7 ms (40 / 400 groups) | **fail** render 6.1 / 26.7 ms, latency 17.2 / 154.2 ms (40 / 400 groups) | **fail** render 6.7 / 35.5 ms, latency 17.2 / 201.6 ms (40 / 400 groups) | pass render 4.1 / 7.3 ms, latency 16.6 / 16.4 ms (40 / 400 groups) |
| P7 proxy | – no momentum input | – no momentum input | – no momentum input | – no momentum input |
| P6-open-10 median ms | 99.3 | 108.3 | 110 | 73.9 |
| P6-open-20 median ms | 117.6 | 157 | 161.6 | 74.5 |
| P6-open-400 median ms | 266.3 | 1795.4 | 1843.9 | 204.2 |

#### WKWebView (system WebKit, Safari 27)

| Property | v0 | v1 | v1s | v2 |
| --- | --- | --- | --- | --- |
| P1 | pass 0 px | pass 0.3 px | pass 0.3 px | pass 0.5 px |
| P1 at offset 0 | **fail** anchor lost | pass 0.7 px | **fail** 42.7 px | **fail** 42 px |
| P2 | **fail** end 9 px, against 1191 px | pass end 0.3 px, against 0 px | **fail** end 199.3 px, against 0 px | **fail** end 100 px, but its own control varied by 100 px |
| P3 | **fail** img 160/160, code 228/228, fold 551.8/690.7 (up/down) | pass img 0/0, code 0/0, fold 0.3/0.3 (up/down) | pass img 0/0, code 0/0, fold 0.3/0.3 (up/down) | **fail** img 0/0, code 228/0, fold 0.5/0 (up/down) |
| P4 | **fail** gap 534 px, wheel-up releases, jump 1 fr, then gap 440 px | pass gap 0 px, wheel-up releases, jump 1 fr, then gap 0 px | **fail** gap 87 px, wheel-up releases, jump 1 fr, then gap 48 px | **fail** gap 0 px, wheel-up does not hold, jump 1 fr, then gap 0 px |
| P4 wheel down while following | **fail** releases follow | pass keeps following | **fail** releases follow | pass keeps following |
| P5 | **fail** first frame 883 px short of the end, 0 hidden fr | pass at the end on the first frame | pass at the end on the first frame | pass at the end on the first frame |
| P6 mount 40 | pass 70 ms (v0 70) | **fail** 297 ms (v0 70) | **fail** 297 ms (v0 70) | pass 64 ms (v0 70) |
| P6 scroll 400 | pass 59.7 fps, p95 frame 18 ms | pass 57–60 fps in 6 of 7 runs, one run 26 fps | pass 55.5 fps, p95 frame 22 ms | pass 59 fps, p95 frame 18 ms |
| P6 chunk p95 | **fail** render 10 / 12 ms, latency 17 / 18 ms (40 / 400 groups) | **fail** render 14 / 24 ms, latency 18 / 125 ms (40 / 400 groups) | **fail** render 7 / 26 ms, latency 18 / 124 ms (40 / 400 groups) | **fail** render 8 / 9 ms, latency 17 / 24 ms (40 / 400 groups) |
| P7 proxy | – anchor row unmounted mid-flick, stall 37 ms | – anchoring held, stall 216 ms, step 872 px | – anchoring held, stall 215 ms, step 931 px | – anchor row unmounted in 2 of 4 loads, stall 64 ms |
| P6-open-10 median ms | 59 | 134 | 110 | 57 |
| P6-open-20 median ms | 70 | 178 | 176 | 59 |
| P6-open-400 median ms | 195 | 2735 | 2127 | 153 |


#### Playwright WebKit

| Property | v0 | v1 | v1s | v2 |
| --- | --- | --- | --- | --- |
| P1 | **fail** anchor lost | pass 0 px | pass 0 px | pass 0.5 px |
| P1 at offset 0 | **fail** anchor lost | pass 0 px | **fail** 42 px | **fail** 42 px |
| P2 | **fail** end 0 px, against 1191 px | pass end 0 px, against 0 px | pass end 0 px, against 0 px | pass end 0.3 px, against 0 px |
| P3 | **fail** img 0/0, code 228/228, fold 621/691 (up/down) | pass img 0/0, code 0/0, fold 0/0 (up/down) | pass img 0/0, code 0/0, fold 0/0 (up/down) | **fail** img 0/0, code 228/0, fold 0.5/0 (up/down) |
| P4 | **fail** gap 440 px, wheel-up does not hold, jump 4 fr, then gap 440 px | pass gap 0 px, wheel-up releases, jump 1 fr, then gap 0 px | **fail** gap 66 px, wheel-up does not hold, jump 1 fr, then gap 48 px | **fail** gap 0 px, wheel-up does not hold, jump 1 fr, then gap 0 px |
| P4 wheel down while following | **fail** releases follow | pass keeps following | **fail** releases follow | pass keeps following |
| P5 | **fail** first frame 883 px short of the end, 0 hidden fr | pass at the end on the first frame | pass at the end on the first frame | pass at the end on the first frame |
| P6 mount 40 | pass 123 ms (v0 123) | **fail** 448 ms (v0 123) | **fail** 358 ms (v0 123) | pass 109 ms (v0 123) |
| P6 scroll 400 | pass 59.7 fps, p95 frame 22 ms | pass 60.1 fps, p95 frame 18 ms | pass 59.3 fps, p95 frame 24 ms | pass 60 fps, p95 frame 18 ms |
| P6 chunk p95 | **fail** render 8 / 13 ms, latency 17 / 24 ms (40 / 400 groups) | **fail** render 9 / 23 ms, latency 22 / 157 ms (40 / 400 groups) | **fail** render 6 / 28 ms, latency 17 / 150 ms (40 / 400 groups) | pass render 7 / 8 ms, latency 18 / 17 ms (40 / 400 groups) |
| P7 proxy | – no momentum input | – no momentum input | – no momentum input | – no momentum input |
| P6-open-10 median ms | 112 | 150 | 156 | 103 |
| P6-open-20 median ms | 108 | 214 | 239 | 100 |
| P6-open-400 median ms | 195 | 2972 | 2362 | 184 |

v1's P1–P4 cells come from the owner with the release fix described in 4.4. The first version failed P4's wheel-up in one of two runs in WKWebView and in Playwright WebKit, and passed everything else. The fix touches only when follow re-engages, so v1's P5–P7 numbers come from the main run.

The content-visibility and progressive runs used React's profiling build. Section 4.6 therefore compares their mount times only with v0 in the same build.

## 3. What the rig is

### 3.1 Variants

| Variant | List | Scroll owner | Browser anchoring | Composer |
| --- | --- | --- | --- | --- |
| `v0` | Today: react-virtuoso with `customScrollParent` inside assistant-ui's `ThreadPrimitive.Viewport`, composed as `ChatThreadViewport.tsx` composes it | Bottom pin, prepend anchor, row anchor, Virtuoso, assistant-ui | Off (`overflow-anchor: none`) | Sticky, inside the scroller |
| `v1` | Plain rows: every message of the loaded window mounted | One module, `shells/scroll-owner.ts`, 109 lines | On | Below the scroller |
| `v1s` | Plain rows, each a `MessageScroller.Item`, with user prompts as `scrollAnchor` | shadcn Message Scroller, `@shadcn/react` 0.3.1 (20 KB minified) | On; the library sets nothing and relies on it | Below the scroller |
| `v2` | LegendList 3.7.2, one row per message | LegendList (`maintainVisibleContentPosition`, `maintainScrollAtEnd`, `initialScrollAtEnd`) | n/a; it positions rows itself | Below the list |

All four render the same production rows: the real `TurnTranscript`, `TurnSlice`, tool rows, markdown, shiki and the fold logic. A Vite plugin redirects two imports inside the transcript. `thread/VirtualMessages` goes to the rig's list switch, so only the list around the rows changes. `messages/turn/use-row-anchor` becomes a no-op outside `v0`, because #461 deletes it. Nothing in `src/` changes.

The rig's row computes its index and the status-row anchor once in the list. Today's `VirtualMessage` runs `findIndex` and `statusAnchorId` over the whole thread in every row on every update. With every row mounted, that made a streamed chunk cost 229 ms p95 at 400 groups in Chromium. #461's plain branch must not carry it over.

`v2`'s flat rows are approximated by the fixture's shape: a turn is cut into five or six assistant messages of one or two parts. The real one-row-per-entry model is the 4–6 days the fallback plan budgets, and was not built.

### 3.2 Fixture

The chat has 160 synthetic turns, and the window holds the newest 40. A turn is a prompt and five or six assistant messages:

- a 100-line Read, plus Bash, Grep and Edit;
- a nested Task agent in every fourth turn;
- an answer with prose, a 30-line code block and an 8-row table, plus a remote image served 150–630 ms late in every seventh turn.

Every third turn is open with its Read output showing, so rows run from 28 px to over 1,000 px. The window starts inside a turn, as a page of "40 groups or 80 items" can. A page is the 80 items before the window: 51 messages, 11–25 thousand px depending on the list. The 400-group cases load 400 turns at once.

### 3.3 Measurement

The probe marks the block 40% down the viewport as the reader's anchor. Once per frame it records the anchor's offset from the viewport top and the gap to the bottom. The sample is taken in a ResizeObserver callback that a 1 px probe element triggers every frame. That runs after layout, scroll anchoring and the list's own observers (created earlier, so called first), just before paint.

The first version sampled in `requestAnimationFrame` and reported failures that never reach the screen: a 66 px gap for `v1`, which corrects it in its resize callback, and a 17,000 px drift at offset 0, which anchoring corrects during layout. Any later scroll test should keep this rule.

Input goes through each engine's own wheel path. Chromium and Playwright WebKit use Playwright's mouse. WKWebView gets real `NSEvent` scroll-wheel events sent to the web view, which take WebKit's threaded scrolling. The P3 cases arrive at their position by scrolling up, or by overshooting and coming back down, because react-virtuoso's compensation depends on the last direction (S6). P2 compares each run with a control run that wheels the same way without a page.

### 3.4 Engines and their limits

- **Chromium**: 159 headless shell (Playwright 1.65), 1280×720 at 1×.
- **WKWebView**: `driver/wkrig.swift`, after the corrected benchmark's `wkbench.swift`. It is one 1280×720 web view at 2× on a 120 Hz display, with a non-persistent store and no Tauri shell. `requestAnimationFrame` ran at 60 Hz.
- **Safari 27 itself was not driven.** `safaridriver` refuses a session until "Allow remote automation" is turned on in Safari's settings, and changing the owner's Safari settings was out of scope. WKWebView runs the same system WebKit (macOS 27.0.1), so the WebKit rows stand for Safari 27, but Safari's own process model was not exercised.
- **Playwright WebKit** 27.2 (build 2388) is Playwright's own WebKit build, headless. It is the third data point, not the reference.

## 4. Findings by property

### 4.1 P1: a page lands above a parked reader

Mid-history, every variant holds within 0.5 px. The one exception is v0 in Playwright WebKit, where Virtuoso unmounted the reader's row in one of two runs.

At offset 0, the reader scrolled to the top waiting for the page, and only `v1` holds. `v1s` and `v2` end 42 px off in every engine. v0 unmounts the reader's row and ends 42–43 px off.

The cause is S1, showing up where nobody expected it. The window starts inside a turn, and the page completes that turn, so the rows at the top regroup: the cut turn's first message loses its own work header and becomes steps of the turn above. At offset 0, the browser's anchor node and the libraries' "first visible item" both sit in those regrouping rows. The reader, 250 px further down, moves by the regrouped height.

`v1`'s owner passes because its fallback at offset 0 re-anchors on the block the reader is looking at, a third of the way down. Its first version anchored on the first visible row and drifted 42 px like the others.

### 4.2 P2: a page lands during 20 wheel events

`v1` passes in all three engines.

- **v0, WebKit (both builds):** one frame moves 1,191 px against the wheel. Virtuoso's estimated shift and Mainframe's prepend anchor take turns (S5). It ends within 9 px.
- **`v1s`, WKWebView:** ends 200 px short of the control in both runs, which is exactly two wheel steps, with no frame moving backwards. Its prepend preservation seems to restore an offset measured before the page landed, which drops the wheel input that arrived in between. It passes in Chromium and Playwright WebKit, where the wheel scroll is applied on the main thread.
- **`v2`, WKWebView:** ends 100 px off, but its own control runs differed by 100 px, so this cell is inconclusive.

### 4.3 P3: an image, a code block, or a fold above the reader

v0 fails in every engine:

- the image: 160 px, except in Playwright WebKit;
- the code block: 228 px;
- the fold: 345–691 px.

It passes only where the target ended outside Virtuoso's 400 px overscan, because there the change is measured later, off screen. This confirms S6 and S11.

`v1` and `v1s` hold within 0.3 px in every engine, after scrolling up and after scrolling down. That includes the automatic fold when a turn ends above the reader's place (S11), with no row anchor at all.

`v2` passes in Chromium but drifts 228 px on the code block (up direction) in both WebKits.

### 4.4 P4: following, release and jump

- **v0:** the bottom gap reaches 440–534 px while streaming in every engine (S10 plus re-measurement). A downward wheel releases follow. The jump lands in 1–4 frames, but the gap returns to 128–440 px afterwards.
- **`v1`:** the gap stays 0 px on every frame, including the end-of-run fold (3.6–4.4 thousand px in this case). A 120 px wheel up releases and stays released. The jump lands in 1 frame. A downward wheel keeps following.
  - The first version re-engaged follow whenever a scroll event found the reader at the bottom. That failed in one of two runs in each WebKit. WebKit applies a wheel on its scrolling thread and delivers the DOM wheel event later, so a follow write can land at the bottom in between, and the rule re-pinned a reader who had just left.
  - The fix re-engages only after the reader's own downward input (wheel down, scroll keys, scrollbar) or the jump. This is S4 again: whichever owner #461 ships has to encode it.
- **`v1s`:**
  - It follows the last item's end a frame late at each new row, with gap spikes of 48–87 px.
  - A downward wheel while following releases follow, as #455 predicted from its input handler.
  - A new turn settles near the top, which the owner accepted.
  - Its bottom-padding gap was a rig layout issue and was fixed before these runs.
- **`v2`:** a 0 px gap in every engine. Its wheel-up release held in one of two runs in each WebKit.

### 4.5 P5: open at the tail

v0 fails. In Chromium the list is hidden for one frame and then shows 2,056 px short of the end. In both WebKits the first frame with rows is 883 px short of the end. That is the blank-then-correct open the corrected benchmark timed in the app's webview. `v1`, `v1s` and `v2` are at the end on the first frame in every engine.

### 4.6 P6: cost

**Mount.** `v1` and `v1s` mount every row.

| Mount to the first frame at the end, median ms | Chromium v0 | Chromium v1 | WKWebView v0 | WKWebView v1 |
| --- | ---: | ---: | ---: | ---: |
| 10 groups | 99 | 108 | 59 | 134 |
| 20 groups | 118 | 157 | 70 | 178 |
| 40 groups | 128 | 249 | 70 | 297 |
| 400 groups | 266 | 1,795 | 195 | 2,735 |

A smaller window does not rescue it in WebKit: even 10 groups is 75 ms over v0. The two remedies, measured in React's profiling build next to v0 in the same build:

| 40 groups, median ms | Chromium | WKWebView | Anchoring (P1, P1 at 0, P3) |
| --- | ---: | ---: | --- |
| v0 | 115 | 70 | fails P3 |
| v1 | 255 | 265–310 | holds |
| v1 + `content-visibility: auto` on rows | 214 | 240 | Chromium holds. **WebKit breaks:** 347 px at offset 0, 1,440 px and 1,770 px on the fold |
| v1 + progressive mount (newest six rows, then twelve per task) | **75** | **49** | holds, both engines; P4 and P5 pass too |

At 10, 20 and 400 groups, progressive mount reaches the end in 61, 64 and 193 ms in Chromium and 36, 39 and 124 ms in WKWebView. It moves the cost to the frames after the first, while the reader is following at the tail, where anchoring keeps them still.

**Scripted scroll at 400 groups.** Every variant reaches 50 fps or more in WebKit. In WKWebView, `v1` ran at 57–60 fps in six of seven runs and at 26 fps once. `v1s` ran at 55–60 fps, but its web process became unreachable in one of eight runs. In Chromium, `v1` and `v1s` reach 51–52 fps with 33 ms p95 frames and 17 long frames in 3 s. v0 and `v2` hold 60 fps.

**Chunk cost.**

| React render per chunk, p95 ms | Chromium 40 | Chromium 400 | WKWebView 40 | WKWebView 400 | Playwright WebKit 40 | Playwright WebKit 400 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| v0 | 6–7 | 8 | 9–10 | 11–12 | 8 | 13 |
| v1 | 5–6 | 27 | 7–14 | 23–24 | 9 | 23 |
| v1s | 7 | 35 | 7 | 26 | 6 | 28 |
| v2 | 4 | 7 | 8 | 9 | 7 | 8 |

At 40 groups the list does not change the chunk cost much. The 8 ms line fails in WebKit for v0 as well, so the remaining cost is in the rows and the turn model, not the list.

At 400 groups, every mounted row holds several store subscriptions (time marker, message, slice selectors) that run on each update. The write-to-DOM latency then reaches 90–200 ms, and the stream fell behind: 26–50 of 150 chunks committed in 5 s, against 136–151 for v0 and `v2`. This is the case for #462's bounded window, measured.

### 4.7 P7: trackpad momentum

**Not run. It needs a person with a trackpad.** The page has a mode for it, `?v=v1&manual=1`, served with `--serve`: pages land as the reader nears the top, and the readout shows the largest single-frame step at each load.

As a proxy, the WKWebView harness sends trackpad flicks with momentum phases. Each flick has five finger frames, then a decaying momentum tail. The results, for two page loads per run and two runs per variant:

| | Main-thread stall while the page mounts | Page height kept out of view | Largest single-frame step after the page |
| --- | ---: | --- | ---: |
| v0 | 21–37 ms | anchor row unmounted mid-flick; not measurable | n/a |
| v1 | 179–216 ms | yes, every load | 732–872 px |
| v1s | 178–215 ms | yes, every load | 160–931 px |
| v2 | 18–64 ms | yes where measurable; row unmounted in 2 of 4 loads | 123–328 px |

A lost anchor would show as a step the size of the page (15,000–17,000 px). That never happened.

The large step needs care. During the 200 ms stall, WebKit kept scrolling on its scrolling thread, and the main thread then caught up in one frame. On screen that may be smooth, with the step only in the main thread's view, or it may be a visible hitch. Only the manual run can tell.

The stall itself is real, and #461 can remove it the same way as the mount: land a history page in slices instead of one 51-message commit.

## 5. What #461 should take from this

### 5.1 The path

Go ahead with step 3 of the migration plan, with `v1`'s design. Two changes to the plan:

- **Mount the tail first.** Mount the newest rows, then prepend the rest of the loaded window in slices. Land history pages the same way. This is what turns P6 from a failure into a pass, and it is safe only because anchoring is on.
- **Make #462's bound part of the same release**, not a later step. At 400 loaded groups, mounting and per-chunk cost are both 7–10× v0. The rig's numbers put a comfortable cap at the daemon's 40-group page, plus one or two pages while the reader is scrolled up.

Prefer the hand-written owner over Message Scroller. `v1s` fails three things `v1` passes:

- P4: a frame of lag per row, and release on a downward wheel.
- P2 in WKWebView: 200 px short of the wheel.
- P1 at offset 0: 42 px.

It also brings 20 KB of minified library, where the owner is 109 lines. Its follow model (settle a new turn near the top) is accepted, but the lag and the downward-wheel release are not part of it. Message Scroller's code remains a useful reference for edge cases. `v1` needed two fixes the rig found, and the library may already handle cases the rig does not cover.

### 5.2 What the owner must encode

The rig found each of these:

1. **Follow by writing `scrollTop` in the resize callback.** P4 shows a 0 px gap. v0's frame-late follow reaches 440–534 px.
2. **Release on upward reader input. Re-engage only on downward reader input or the jump**, never on "a scroll event at the bottom". WebKit's wheel event arrives after its threaded scroll.
3. **At offset 0, re-anchor once on the reader's block**, not the first visible row. A page that completes a cut turn regroups the top rows.
4. **Compute row indexes once in the list.** Do not carry over `VirtualMessage`'s per-row `findIndex` and `statusAnchorId`.
5. **No `content-visibility` on rows.** WebKit loses anchoring with it.
6. **Keep the row anchor deleted.** The automatic fold above the reader held within 0.3 px with no row anchor, in every engine.

### 5.3 The rig as a regression gate

The rig runs in about 30 minutes per engine, with no app and no daemon. The Chromium half could run in CI. The WKWebView half needs a logged-in macOS session with a screen, so it is a manual pre-release check.

## 6. What was not tested

- **Safari 27 itself.** `safaridriver` needs "Allow remote automation" turned on in Safari's settings, so WebKit was measured in a plain `WKWebView` on the same system WebKit, with no Tauri shell.
- **P7 by hand.** Only the synthesized-momentum proxy ran.
- **The real app.** Rows, markdown and the turn model are production code. The composer is a fixed-height stand-in, and the scroll-fade mask, gates, queue, find, sub-agent tabs and Activity jumps are absent. `v1` places the composer below the scroller; #461 has to decide that (S3).
- **Real transcripts.** The fixture is synthetic: Claude-shaped turns, with no Codex shapes, attachments or permission gates.
- **`v2`'s real row model.** Its rows come from the fixture's message cut.
- **Older WebKit** (macOS 14 and earlier, without anchoring). `v1`'s fallback for engines without `overflow-anchor` is written but untested.
- **Jumps and find** (S14, S15) and **sub-agent views** (S19).
- **Recordings.** Results are numbers only. No screen recording was made.

The WKWebView harness lost its web process five times in about 450 page loads ("Completion handler for function call is no longer reachable"):

- four times in `v1s` and `v2` runs at 400 groups or while streaming;
- once with content-visibility.

The first of them hung the driver. The driver now times out, restarts the harness, and records the case as an error. Those cases are absent from the tables, and each had another repetition that completed.

## 7. Open questions

1. **Is the main thread's catch-up step visible during momentum?** The manual P7 run answers this. If it is visible, slicing history pages (5.1) is required, not optional.
2. **Where should the composer go?** It sits below the scroller in `v1`. Keeping it sticky inside the scroller, as today (S3), was not measured with browser anchoring.
3. **What cap should #462 use?** The rig suggests the 40-group page plus one or two pages. #462 should measure it on real chats.
4. **Should Chromium run the rig in CI**, and against what time budget?
5. **Is `v1s`'s 200 px P2 loss in WKWebView a library issue worth reporting upstream?** It did not reproduce in Chromium or Playwright WebKit.

## 8. Reproducing

```sh
pnpm install
pnpm --filter @qlan-ro/mainframe-types build
pnpm --filter @qlan-ro/mainframe-e2e exec playwright install chromium webkit
node packages/ui/benchmarks/transcript-list/driver/run.mjs --engines chromium,wk,webkit --repeat 2 --out results.json
node packages/ui/benchmarks/transcript-list/driver/summarize.mjs results.json
```

A full matrix takes about 30 minutes per engine. `--variants v1,v1+progressive --cases P5,P6` narrows a run. `--serve` serves the page for the manual P7 run (`?v=v1&manual=1`). The `wk` engine opens a borderless 1280×720 window at the bottom-left of the screen for the duration of the run.
