# Transcript list proof rig: P1–P7 in Chromium and WebKit (26 November 2026)

Todo #455. It decides which path #461 takes. The proof spec is section 4.5 of the architecture review's part 2, which is kept outside the repository. The rig is [`packages/ui/benchmarks/transcript-list/`](../../packages/ui/benchmarks/transcript-list/README.md). Everything here ran on a synthetic chat (`@assistant-ui/react` 0.15.38, react-virtuoso 4.18.24, React 19.3.1). No app, daemon, or real transcript was involved.

**What the numbers are.**

- **Branch and `v0`.** The tables come from one rerun on the branch after it was rebased onto #980 (todo #456), so `v0` mirrors the viewport as it is after #980. That change turns off assistant-ui's remaining scroll controllers, drives the scroll-to-bottom button from the pin, and gives every markdown image a fixed-height frame. Since then images no longer change the transcript's height, so the P3 image case measures nothing for `v0`.
- **React build.** Every table names the React build it was measured with. The main matrix and everything in it use React's profiling build (`<Profiler>` needs it for the P6 chunk row). Only the same-session A/B in 4.8 uses plain `react-dom`. A table never mixes the two, and the two builds' mount times are not comparable with each other.
- **Raw results.** [`results/`](../../packages/ui/benchmarks/transcript-list/results/) holds the JSON behind every cell (`matrix-*.json`, `ab-980-*.json`), without machine paths, with the load average at the end of each part. Section 8 reproduces them.
- **Load.** The machine was heavily loaded by other work (12 cores, load average 10–30 during the runs; per part in the JSON). Repetitions are modest: two per cell (one in Playwright WebKit), five opens per mount size. Compare cells within a table, not across the two builds or across sessions. Absolute mount times here are higher than in a quiet session.

## 1. Short answer

**#461 takes the primary path: `v1`, no virtualizer, with the hand-written owner. It also needs two changes the spec did not have: mount the tail first, and bound the window. Tail-first needs one more thing it does not have yet (see the second bullet below).**

- **`v1` passes P1 to P5 in Chromium and Playwright WebKit, and in WKWebView (the system WebKit that Safari 27 and the app use) with one exception:** under load, one of four WKWebView P4 runs took 3 frames to land the jump (the line is 2). That covers a page landing above a parked reader, a page landing mid-wheel, a code block and the automatic fold above the reader in both scroll directions, following at a 0 px gap through 10 s of streaming and a 4,000 px fold, release and jump, and opening at the tail on the first visible frame. Browser anchoring did the work in every case. No row anchor and no settle loop were involved.
- **It fails P6 as specified.** Mounting all 40 groups takes 342 ms in Chromium and 553 ms in WKWebView, against v0's 133 and 248. The decision rule's first remedy, `content-visibility: auto`, is ruled out: it breaks WebKit's anchoring (347 px at offset 0, 1,440–1,770 px on the fold) and saves little.
- **Mounting the tail first fixes the first paint, not the cost.**
  - With the newest six rows mounted first and the rest of the window prepended twelve rows per task, the tail is on screen after 96 ms in Chromium and 64 ms in WKWebView, faster than v0 (133 and 248).
  - The whole window is only in after 0.9 s at 40 groups (915 ms Chromium, 870 ms WKWebView, 1.2 s Playwright WebKit), and the longest main-thread block per slice is 171–180 ms. At 400 groups it takes 18–25 s, with slices of 146 ms (Chromium) to 1.3–2.1 s (WebKit). The one-shot mount of the same window takes 342 ms (Chromium) and 553 ms (WKWebView), so slicing cuts the longest block by half to two thirds. It does not bring it near a frame.
  - With slices still landing, P1 mid-history, P2 (movement against the wheel), P3 and P4 pass in every engine. **A reader parked at offset 0 does not**: the page drifts by the height of the slices that land (3,437 px in Chromium and Playwright WebKit, 75,984 px in WKWebView). That is consistent with the browser not anchoring at `scrollTop` 0. `v1`'s owner re-anchors there for a history page, and tail-first needs the same treatment for each slice (or must hold slices while the reader is at the top).
- **400 groups unvirtualized is not viable**, so the bounded window (#462) is required. It takes 2.6–3.9 s to mount, and a streamed chunk costs 26–38 ms of React render time at p95, so the stream fell behind: 21–38 of 151 chunks committed in 5 s against 133–151 for v0 and `v2`. At 40 groups the chunk cost matches v0.
- **Message Scroller does not replace the owner, even patched.**
  - The two behaviours behind `v1s`'s P4 failure are real and small. The library follows inside `requestAnimationFrame`, a frame late (gap spikes of 48–66 px), and any wheel direction releases follow. A vendored copy with those two patched (`v1s-patched`, about 25 changed lines) follows within 1–2 px and keeps following on a downward wheel.
  - It still fails what `v1` passes: a page landing above a reader at offset 0 (42 px in every engine), a page landing mid-wheel in WKWebView (200 px short of the wheel), and an upward release that did not hold in 2 of 6 Chromium runs. `preserveScrollOnPrepend={false}` is not a way out: the library then reads a prepend as a new turn and scrolls to it (a 29,000 px jump).
  - Its mount is comparable with `v1`'s one-shot mount (330–424 ms), and with tail-first slicing it is comparable with `v1` + tail-first (89–93 ms). So the rest of the gap is correctness, not cost. Section 5.1 counts the code each path leaves us maintaining.
- **`v2` (LegendList) is not needed.** It is the cheapest variant: it mounts as fast as v0 or faster, and its chunk cost is 8–12 ms at 400 groups in every engine. But it drifts 42 px at offset 0 and anchoring is lost in the WKWebView momentum proxy. It stays the fallback if a bounded `v1` window misses P6 in the real app.
- **#980, merged during the runs, did two things in the rig (section 4.8):** it introduced a 1,191 px jump during plain upward wheeling in Chromium (v0 passed P2 before and fails it after, with the page landing or not), and in WKWebView it moved the first paint of the tail from 87 ms to 216 ms (median), about 130 ms later. That is a lead for the app, not part of #461's decision.
- **P7 (trackpad momentum by hand) was not run; it needs the owner's hands.** A synthesized-momentum proxy in WKWebView showed anchoring held through every page load for `v1`, `v1s` and `v1s-patched`. It also showed a 200–345 ms main-thread stall each time a 51-message page mounts unvirtualized, after which the main thread catches up with WebKit's threaded scroll in one 400–930 px step. Whether that step is visible is the open question for the manual run.

## 2. Verdict table

A cell is the worst of the repetitions. Mount times are medians of five opens (three at 400 groups). All tables in this section: **React profiling build**.

- **"Lost"** means the virtualizer unmounted the reader's anchor row, so the anchor could not be followed. That counts as a failure.
- **Extra cases:** "P1 at offset 0" and "P4 wheel down" go beyond the spec's lines. P1 at offset 0 also fails if the run did not park the reader at 0 (the cell shows where it did).
- **P2** compares each run with its own control (the same wheel input, no page). The cell shows the movement against the wheel for the page run and, in brackets, for the control. A jump the control shows too is a plain-wheel jump, and fails the cell.
- **P4** fails if the run never reached the live edge (a run with no frames at the edge reports no gap, not 0).
- **P5** is stricter than the spec's wording: the first frame whose rows are really visible (`checkVisibility`, so a `visibility: hidden` list is not visible) must be at the end (gap ≤ 1 px). "Hidden fr" counts frames with rows in the DOM and none visible. "First visible / tail ms" is the time to the first visible frame and to the first frame showing the last row.
- **P6 chunk** is React's render time per chunk (`<Profiler>`). "Latency" is the time from the store write to the first DOM mutation, which includes up to a frame of the runtime's batching.
- **Variants with options** (`+progressive`, `+nopreserve`, `+cv`) are listed after the plain variants. A blank cell was not run.
- **Tail-first scoring and "started while slices still land"** are described in 4.6.

### Chromium (React build: profiling)

| Property | v0 | v1 | v1s | v1s-patched | v2 |
| --- | --- | --- | --- | --- | --- |
| P1 | pass 0 px | pass 0.2 px | pass 0.2 px | pass 0.2 px | pass 0.4 px |
| P1 at offset 0 | **fail** anchor lost, parked at 0/0 px | pass 0.2 px, parked at 0/0 px | **fail** 41.8 px, parked at 0/0 px | **fail** 41.8 px, parked at 0/0 px | **fail** 42 px, parked at 0/0 px |
| P2 | **fail** end 0 px, against 1191 px (control 1191 px) | pass end 0.2 px, against 0.2 px (control 0 px) | pass end 0.2 px, against 0.2 px (control 0 px) | pass end 0.2 px, against 0.2 px (control 0 px) | pass end 0.3 px, against 0.3 px (control 0 px) |
| P3 | **fail** img 0/0, code 228/228, fold 620.7/690.7 (up/down) | pass img 0/0, code 0/0, fold 0.3/0.3 (up/down) | pass img 0/0, code 0/0, fold 0.3/0.3 (up/down) | pass img 0/0, code 0/0, fold 0.3/0.3 (up/down) | pass img 0/0, code 0/0, fold 0.5/0 (up/down) |
| P4 | **fail** gap 440 px, wheel-up releases, jump 1 fr, then gap 440 px | pass gap 0 px, wheel-up releases, jump 1 fr, then gap 0 px | **fail** gap 66 px, wheel-up does not hold, jump 1 fr, then gap 36 px | **fail** gap 1 px, wheel-up does not hold, jump 1 fr, then gap 0 px | pass gap 0 px, wheel-up releases, jump 1 fr, then gap 0 px |
| P4 wheel down while following | **fail** releases follow | pass keeps following | **fail** releases follow | pass keeps following | pass keeps following |
| P5 | **fail** first visible frame 737 px short of the end, 0 visible fr before the end, 1 hidden fr | pass at the end on the first visible frame (0 hidden fr) | pass at the end on the first visible frame (0 hidden fr) | pass at the end on the first visible frame (0 hidden fr) | pass at the end on the first visible frame (2 hidden fr) |
| P5 first visible / tail ms | – 133.2 / 133.2 ms | – 341.5 / 341.5 ms | – 347 / 347 ms | – 330.1 / 330.1 ms | – 120.7 / 120.7 ms |
| P6 mount 40 | pass 133.2 ms (v0 133.2) | **fail** 341.5 ms (v0 133.2) | **fail** 347 ms (v0 133.2) | **fail** 330.1 ms (v0 133.2) | pass 120.7 ms (v0 133.2) |
| P6 scroll 400 | pass 59.7 fps, p95 frame 16.8 ms | **fail** 44 fps, p95 frame 66.6 ms | **fail** 38.9 fps, p95 frame 83.3 ms | **fail** 43.6 fps, p95 frame 66.7 ms | pass 59.7 fps, p95 frame 16.8 ms |
| P6 chunk p95 | **fail** render 7.7 / 11.2 ms, latency 16.3 / 18.1 ms (40 / 400 groups) | **fail** render 7.8 / 37.9 ms, latency 18.1 / 229.2 ms (40 / 400 groups) | **fail** render 7.7 / 47.5 ms, latency 19 / 248.2 ms (40 / 400 groups) | **fail** render 8 / 41.4 ms, latency 20.4 / 284.2 ms (40 / 400 groups) | **fail** render 5.2 / 8.4 ms, latency 16.5 / 16.8 ms (40 / 400 groups) |
| P6-open-10 median ms | 114.6 | 145.8 | 150.7 | 152.2 | 113 |
| P6-open-20 median ms | 115.5 | 211.7 | 217.7 | 212.9 | 112.3 |
| P6-open-400 median ms | 269.4 | 2614.3 | 2601.7 | 2642.3 | 260.9 |

### Chromium, variants with options (React build: profiling)

| Property | v1+progressive | v1s+nopreserve | v1s-patched+nopreserve | v1s-patched+progressive | v1+cv |
| --- | --- | --- | --- | --- | --- |
| P1 | – n/a px | **fail** 29260.2 px | **fail** 29260.2 px | pass 0.2 px | pass 0 px |
| P1 at offset 0 | – n/a | **fail** 53386.2 px, parked at 0/0 px | **fail** 53386.2 px, parked at 0/0 px | **fail** 41.8 px, parked at 0/0 px | pass 0.1 px, parked at 0/0 px |
| P2 | – n/a | **fail** end 19720.2 px, against 19720.2 px (control 0 px) | **fail** end 19720.2 px, against 19720.2 px (control 0 px) | pass end 0.2 px, against 0.2 px (control 0 px) | – n/a |
| P3 | – n/a | – n/a | – n/a | – n/a | pass img 0/0, code 0/0, fold 0.3/0.3 (up/down) |
| P4 | – n/a | **fail** gap 66 px, wheel-up does not hold, jump 1 fr, then gap 40 px | **fail** gap 1 px, wheel-up does not hold, jump 1 fr, then gap 0 px | **fail** gap 1 px, wheel-up does not hold, jump 1 fr, then gap 0 px | – n/a |
| P4 wheel down while following | – n/a | **fail** releases follow | pass keeps following | pass keeps following | – n/a |
| P5 | pass at the end on the first visible frame (0 hidden fr) | – n/a | – n/a | pass at the end on the first visible frame (0 hidden fr) | pass at the end on the first visible frame (0 hidden fr) |
| P5 first visible / tail ms | – 95.2 / 95.2 ms | – n/a | – n/a | – 89.2 / 89.2 ms | – 252.3 / 252.3 ms |
| P6 mount 40 | pass 95.2 ms (v0 133.2) | – n/a ms (v0 133.2) | – n/a ms (v0 133.2) | pass 89.2 ms (v0 133.2) | **fail** 252.3 ms (v0 133.2) |

#### Chromium: tail-first mount scored to completion (React build: profiling)

| Variant | Window | Tail visible, ms | First slice, ms | Whole window in, ms | Longest first mount, ms | Longest slice, ms | Commits |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| v1+progressive | 40 groups | 95.6 | 67.8 | 915.3 (max 915.3) | 35.2 | 171 (max 171) | 18 |
| v1+progressive | 400 groups | 232.3 | 204.3 | 21530.1 (max 21530.1) | 35.9 | 145.8 (max 145.8) | 176 |
| v1s-patched+progressive | 40 groups | 92.3 | 68.8 | 832.1 (max 832.1) | 30.8 | 109 (max 109) | 18 |
| v1s-patched+progressive | 400 groups | 219.7 | 195.7 | 21279.1 (max 21279.1) | 31 | 125.7 (max 125.7) | 176 |

### Chromium: P1-P4 started while slices still land (React build: profiling)

| Property | v1+progressive | v1s-patched+progressive |
| --- | --- | --- |
| P1 | pass 0.6 px | pass 0.6 px |
| P1 at offset 0 | **fail** 3437.5 px, parked at 0/0 px | **fail** 0.7 px, parked at 18567/18507 px |
| P2 | pass against 0.2 px (control 0.1 px) | **fail** against 100.2 px (control 0.1 px) |
| P3 | pass img n/a/n/a, code 0/n/a, fold 0.3/n/a (up/down) | pass img n/a/n/a, code 0/n/a, fold 0.3/n/a (up/down) |
| P4 | pass gap 0 px, wheel-up releases, jump 1 fr, then gap 0 px | pass gap 1 px, wheel-up releases, jump 1 fr, then gap 0 px |
| P4 wheel down while following | pass keeps following | pass keeps following |

### WKWebView (Safari 27 WebKit) (React build: profiling)

| Property | v0 | v1 | v1s | v1s-patched | v2 |
| --- | --- | --- | --- | --- | --- |
| P1 | pass 0 px | pass 0.3 px | pass 0.3 px | pass 0.3 px | pass 0.5 px |
| P1 at offset 0 | **fail** anchor lost, parked at 0/0 px | pass 0.7 px, parked at 0/0 px | **fail** 42.7 px, parked at 0/0 px | **fail** 42.7 px, parked at 0/0 px | **fail** 42 px, parked at 0/0 px |
| P2 | **fail** end 272 px, against 1191 px (control 1191 px) | pass end 0.3 px, against 0.3 px (control 0 px) | **fail** end 199.3 px, against 0 px (control 0 px) | **fail** end 199.3 px, against 0.3 px (control 0 px) | pass end 0.3 px, against 0 px (control 0 px) |
| P3 | **fail** img n/a/0, code 228/228, fold 344.8/551.8 (up/down) | pass img 0/0, code 0/0, fold 0.3/0.3 (up/down) | pass img 0/0, code 0/0, fold 0.3/0.3 (up/down) | pass img 0/0, code 0/0, fold 0.3/0.3 (up/down) | pass img 0/0, code 0/0, fold 0.5/0 (up/down) |
| P4 | **fail** gap 462 px, wheel-up releases, jump 1 fr, then gap 516 px | **fail** gap 0 px, wheel-up releases, jump 3 fr, then gap 0 px | **fail** gap 48 px, wheel-up releases, jump 1 fr, then gap 48 px | **fail** gap 2 px, wheel-up releases, jump 1 fr, then gap 0 px | **fail** gap 0 px, wheel-up does not hold, jump 2 fr, then gap 0 px |
| P4 wheel down while following | **fail** releases follow | pass keeps following | **fail** releases follow | pass keeps following | pass keeps following |
| P5 | **fail** first visible frame 2173 px short of the end, 1 visible fr before the end, 1 hidden fr | pass at the end on the first visible frame (0 hidden fr) | pass at the end on the first visible frame (0 hidden fr) | pass at the end on the first visible frame (0 hidden fr) | pass at the end on the first visible frame (2 hidden fr) |
| P5 first visible / tail ms | – 134 / 248 ms | – 553 / 553 ms | – 403 / 403 ms | – 424 / 424 ms | – 87 / 87 ms |
| P6 mount 40 | pass 248 ms (v0 248) | **fail** 553 ms (v0 248) | **fail** 403 ms (v0 248) | **fail** 424 ms (v0 248) | pass 87 ms (v0 248) |
| P6 scroll 400 | pass 61.6 fps, p95 frame 18 ms | **fail** 22.9 fps, p95 frame 28 ms | **fail** 23.6 fps, p95 frame 34 ms | **fail** 29.8 fps, p95 frame 27 ms | pass 60.1 fps, p95 frame 18 ms |
| P6 chunk p95 | **fail** render 12 / 13 ms, latency 17 / 23 ms (40 / 400 groups) | **fail** render 11 / 27 ms, latency 28 / 147 ms (40 / 400 groups) | **fail** render 10 / 54 ms, latency 22 / 224 ms (40 / 400 groups) | **fail** render 11 / 32 ms, latency 33 / 240 ms (40 / 400 groups) | **fail** render 7 / 10 ms, latency 18 / 26 ms (40 / 400 groups) |
| P7 proxy | – anchoring lost, stall 35 ms, step lost px | – anchoring held, stall 234 ms, step 765 px | – anchoring held, stall 345 ms, step 929 px | – anchoring held, stall 200 ms, step 398 px | – anchoring lost, stall 54 ms, step lost px |
| P6-open-10 median ms | 243 | 127 | 139 | 194 | 82 |
| P6-open-20 median ms | 251 | 191 | 244 | 218 | 70 |
| P6-open-400 median ms | 393 | 3868 | 4714 | 4575 | 181 |

### WKWebView (Safari 27 WebKit), variants with options (React build: profiling)

| Property | v1+progressive | v1s+nopreserve | v1s-patched+nopreserve | v1s-patched+progressive | v1+cv |
| --- | --- | --- | --- | --- | --- |
| P1 | – n/a px | **fail** 29259.3 px | **fail** 29259.3 px | pass 0.3 px | pass 0 px |
| P1 at offset 0 | – n/a | **fail** 53385.3 px, parked at 0/0 px | **fail** 53385.3 px, parked at 0/0 px | **fail** 42.7 px, parked at 0/0 px | **fail** 347.1 px, parked at 0/0 px |
| P2 | – n/a | **fail** end 19919.4 px, against 19819.3 px (control 0 px) | **fail** end 19919.4 px, against 19819.3 px (control 0 px) | **fail** end 199.3 px, against 0 px (control 0 px) | – n/a |
| P3 | – n/a | – n/a | – n/a | – n/a | **fail** img 0/0, code 0/0, fold 1770/1439.9 (up/down) |
| P4 | – n/a | **fail** gap 50 px, wheel-up releases, jump 1 fr, then gap 48 px | **fail** gap 2 px, wheel-up does not hold, jump 1 fr, then gap 0 px | **fail** gap 2 px, wheel-up releases, jump 1 fr, then gap 0 px | – n/a |
| P4 wheel down while following | – n/a | **fail** releases follow | pass keeps following | pass keeps following | – n/a |
| P5 | pass at the end on the first visible frame (0 hidden fr) | – n/a | – n/a | pass at the end on the first visible frame (0 hidden fr) | pass at the end on the first visible frame (0 hidden fr) |
| P5 first visible / tail ms | – 63 / 63 ms | – n/a | – n/a | – 93 / 93 ms | – 344 / 344 ms |
| P6 mount 40 | pass 63 ms (v0 248) | – n/a ms (v0 248) | – n/a ms (v0 248) | pass 93 ms (v0 248) | **fail** 344 ms (v0 248) |

#### WKWebView (Safari 27 WebKit): tail-first mount scored to completion (React build: profiling)

| Variant | Window | Tail visible, ms | First slice, ms | Whole window in, ms | Longest first mount, ms | Longest slice, ms | Commits |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| v1+progressive | 40 groups | 64 | 52 | 870 (max 870) | 14 | 180 (max 180) | 18 |
| v1+progressive | 400 groups | 181 | 135 | 17945 (max 17945) | 51 | 1347 (max 1347) | 176 |
| v1s-patched+progressive | 40 groups | 84 | 74 | 1019 (max 1019) | 37 | 177 (max 177) | 18 |
| v1s-patched+progressive | 400 groups | 177 | 165 | 28650 (max 28650) | 71 | 2676 (max 2676) | 176 |

### WKWebView (Safari 27 WebKit): P1-P4 started while slices still land (React build: profiling)

| Property | v1+progressive | v1s-patched+progressive |
| --- | --- | --- |
| P1 | pass 0.6 px | pass 0.6 px |
| P1 at offset 0 | **fail** 75983.6 px, parked at 0/0 px | **fail** 0.8 px, parked at 13401/18565 px |
| P2 | pass against 0.5 px (control 0.5 px) | pass against 0.7 px (control 0.7 px) |
| P3 | pass img n/a/n/a, code 0/n/a, fold 0.3/n/a (up/down) | **fail** img n/a/n/a, code 0/n/a, fold 276.9/n/a (up/down) |
| P4 | pass gap 0 px, wheel-up releases, jump 1 fr, then gap 0 px | **fail** gap 0 px, wheel-up does not hold, jump 1 fr, then gap 0 px |
| P4 wheel down while following | pass keeps following | pass keeps following |

### Playwright WebKit (React build: profiling)

| Property | v0 | v1 | v1s | v1s-patched | v2 |
| --- | --- | --- | --- | --- | --- |
| P1 | pass 0 px | pass 0 px | pass 0 px | pass 0 px | pass 0.5 px |
| P1 at offset 0 | **fail** 172 px, parked at 0 px | pass 0 px, parked at 0 px | **fail** 42 px, parked at 0 px | **fail** 42 px, parked at 0 px | **fail** 42 px, parked at 0 px |
| P2 | **fail** end 200 px, against 92 px (control 92 px) | pass end 0 px, against 0 px (control 0 px) | pass end 0 px, against 0 px (control 0 px) | pass end 0 px, against 0 px (control 0 px) | pass end 0.3 px, against 0 px (control 0 px) |
| P3 | **fail** img 0/0, code 0/228, fold 345/691 (up/down) | pass img 0/0, code 0/0, fold 0/0 (up/down) | pass img 0/0, code 0/0, fold 0/0 (up/down) | pass img 0/0, code 0/0, fold 0/0 (up/down) | pass img 0/0, code 0/0, fold 0.5/0 (up/down) |
| P4 | **fail** gap 440 px, wheel-up does not hold, jump 3 fr, then gap 106 px | pass gap 0 px, wheel-up releases, jump 1 fr, then gap 0 px | **fail** gap 48 px, wheel-up releases, jump 1 fr, then gap 48 px | **fail** gap 0 px, wheel-up does not hold, jump 1 fr, then gap 0 px | **fail** gap 0 px, wheel-up does not hold, jump 1 fr, then gap 0 px |
| P4 wheel down while following | **fail** releases follow | pass keeps following | **fail** releases follow | pass keeps following | pass keeps following |
| P5 | **fail** first visible frame 2173 px short of the end, 1 visible fr before the end, 1 hidden fr | pass at the end on the first visible frame (0 hidden fr) | pass at the end on the first visible frame (0 hidden fr) | pass at the end on the first visible frame (0 hidden fr) | pass at the end on the first visible frame (2 hidden fr) |
| P5 first visible / tail ms | – 217 / 300 ms | – 432 / 432 ms | – 359 / 359 ms | – 396 / 396 ms | – 279 / 279 ms |
| P6 mount 40 | pass 300 ms (v0 300) | **fail** 432 ms (v0 300) | **fail** 359 ms (v0 300) | **fail** 396 ms (v0 300) | pass 279 ms (v0 300) |
| P6 scroll 400 | pass 62.3 fps, p95 frame 22 ms | pass 60.3 fps, p95 frame 20 ms | pass 59.8 fps, p95 frame 24 ms | pass 59.9 fps, p95 frame 24 ms | pass 65.8 fps, p95 frame 18 ms |
| P6 chunk p95 | **fail** render 12 / 14 ms, latency 14 / 29 ms (40 / 400 groups) | **fail** render 8 / 26 ms, latency 18 / 160 ms (40 / 400 groups) | **fail** render 8 / 24 ms, latency 18 / 157 ms (40 / 400 groups) | **fail** render 8 / 24 ms, latency 17 / 154 ms (40 / 400 groups) | **fail** render 6 / 12 ms, latency 17 / 35 ms (40 / 400 groups) |
| P6-open-10 median ms | 197 | 156 | 160 | 167 | 264 |
| P6-open-20 median ms | 277 | 224 | 228 | 242 | 263 |
| P6-open-400 median ms | 367 | 3132 | 2421 | 2590 | 284 |

### Playwright WebKit, variants with options (React build: profiling)

| Property | v1+progressive |
| --- | --- |
| P5 | pass at the end on the first visible frame (0 hidden fr) |
| P5 first visible / tail ms | – 117 / 117 ms |
| P6 mount 40 | pass 117 ms (v0 300) |

#### Playwright WebKit: tail-first mount scored to completion (React build: profiling)

| Variant | Window | Tail visible, ms | First slice, ms | Whole window in, ms | Longest first mount, ms | Longest slice, ms | Commits |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| v1+progressive | 40 groups | 118 | 87 | 1171 (max 1171) | 43 | 167 (max 167) | 18 |
| v1+progressive | 400 groups | 198 | 167 | 24848 (max 24848) | 125 | 2090 (max 2090) | 176 |

### Playwright WebKit: P1-P4 started while slices still land (React build: profiling)

| Property | v1+progressive |
| --- | --- |
| P1 | pass 0 px |
| P1 at offset 0 | **fail** 3437 px, parked at 0/0 px |
| P2 | pass against 0 px (control 1 px) |
| P3 | pass img n/a/n/a, code 0/n/a, fold 0/n/a (up/down) |
| P4 | pass gap 0 px, wheel-up releases, jump 1 fr, then gap 0 px |
| P4 wheel down while following | pass keeps following |


## 3. What the rig is

### 3.1 Variants

| Variant | List | Scroll owner | Browser anchoring | Composer |
| --- | --- | --- | --- | --- |
| `v0` | Today: react-virtuoso with `customScrollParent` inside assistant-ui's `ThreadPrimitive.Viewport`, composed as `ChatThreadViewport.tsx` composes it after #980 | Bottom pin, prepend anchor, row anchor, Virtuoso, assistant-ui | Off (`overflow-anchor: none`) | Sticky, inside the scroller |
| `v1` | Plain rows: every message of the loaded window mounted | One module, `shells/scroll-owner.ts`, 109 lines | On | Below the scroller |
| `v1s` | Plain rows, each a `MessageScroller.Item`, with user prompts as `scrollAnchor` | shadcn Message Scroller, `@shadcn/react` 0.3.1 (20 KB minified) | On; the library sets nothing and relies on it | Below the scroller |
| `v1s-patched` | The same, from a vendored copy of 0.3.1's source (`vendor/`, MIT, notice kept) with two marked patches | Message Scroller, patched: an upward wheel alone releases follow; follow runs inside the ResizeObserver callback, with no `requestAnimationFrame` | On | Below the scroller |
| `v2` | LegendList 3.7.2, one row per message | LegendList (`maintainVisibleContentPosition`, `maintainScrollAtEnd`, `initialScrollAtEnd`) | n/a; it positions rows itself | Below the list |

Option flags add to a variant: `+progressive` (tail-first mount, on `v1`, `v1s` and `v1s-patched`), `+cv` (`content-visibility: auto` on rows) and `+nopreserve` (`preserveScrollOnPrepend={false}` on the Message Scroller viewport).

All variants render the same production rows: the real `TurnTranscript`, `TurnSlice`, tool rows, markdown, shiki and the fold logic. A Vite plugin redirects two imports inside the transcript. `thread/VirtualMessages` goes to the rig's list switch, so only the list around the rows changes. `messages/turn/use-row-anchor` becomes a no-op outside `v0`, because #461 deletes it. Nothing in `src/` changes.

The rig's row computes its index and the status-row anchor once in the list. Today's `VirtualMessage` runs `findIndex` and `statusAnchorId` over the whole thread in every row on every update. With every row mounted, that made a streamed chunk cost 229 ms p95 at 400 groups in Chromium in the first version of the rig. #461's plain branch must not carry it over.

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

Input goes through each engine's own wheel path. Chromium and Playwright WebKit use Playwright's mouse. WKWebView gets real `NSEvent` scroll-wheel events sent to the web view, which take WebKit's threaded scrolling. The P3 cases arrive at their position by scrolling up, or by overshooting and coming back down, because react-virtuoso's compensation depends on the last direction (S6). P2 compares each run with a control run that wheels the same way without a page, and both must stay put.

The boot watcher records, per frame from before the first render, whether message rows exist, whether any is really visible (an element under the viewport centre, which skips `visibility: hidden` content, and `checkVisibility` on the last row), and where the list stands. P1 records where `park()` left the reader. P4 reports a run that never reached the live edge as a failure.

### 3.4 Engines and their limits

- **Chromium**: 159 headless shell (Playwright 1.65), 1280×720 at 1×.
- **WKWebView**: `driver/wkrig.swift`, after the corrected benchmark's `wkbench.swift`. It is one 1280×720 web view at 2× on a 120 Hz display, with a non-persistent store and no Tauri shell. `requestAnimationFrame` ran at 60 Hz.
- **Safari 27 itself was not driven.** `safaridriver` refuses a session until "Allow remote automation" is turned on in Safari's settings, and changing the owner's Safari settings was out of scope. WKWebView runs the same system WebKit (macOS 27.0.1), so the WebKit rows stand for Safari 27, but Safari's own process model was not exercised.
- **Playwright WebKit** 27.2 (build 2388) is Playwright's own WebKit build, headless. It is the third data point, not the reference. It ran one repetition per cell.

## 4. Findings by property

### 4.1 P1: a page lands above a parked reader

Mid-history, every variant holds within 0.5 px in every engine.

At offset 0, the reader scrolled to the top waiting for the page, and only `v1` holds. `v1s`, `v1s-patched` and `v2` end 42 px off in every engine. v0 unmounts the reader's row (Chromium and WKWebView) or ends 172 px off (Playwright WebKit). Every run parked the reader at 0 (the cell shows it).

The cause is S1, showing up where nobody expected it. The window starts inside a turn, and the page completes that turn, so the rows at the top regroup: the cut turn's first message loses its own work header and becomes steps of the turn above. At offset 0, the browser's anchor node and the libraries' "first visible item" both sit in those regrouping rows. The reader, 250 px further down, moves by the regrouped height.

`v1`'s owner passes because its fallback at offset 0 re-anchors on the block the reader is looking at, a third of the way down. Its first version anchored on the first visible row and drifted 42 px like the others. Patching Message Scroller's follow behaviour does not touch this, so `v1s-patched` fails the same way.

### 4.2 P2: a page lands during 20 wheel events

`v1` passes in all three engines.

- **v0 fails in all three engines, and the failure is not the page.** In Chromium the control run, which wheels the same 20 events and lands no page, moves 1,191 px against the wheel in one frame, exactly as the page run does, and both runs end in the same place. The control also jumps in WKWebView (92 or 1,191 px, varying run to run) and Playwright WebKit (92 px). So this is a jump in plain upward wheeling through virtualized rows, not an effect of prepending. S5 (Virtuoso's estimated shift and Mainframe's prepend anchor taking turns) was the wrong reading of this cell. The jump is the size of Virtuoso's correction when it measures rows it had estimated, and nothing absorbs it with browser anchoring off. That reading was not isolated further. Section 4.8 shows when the Chromium jump appeared.
- **`v1s` and `v1s-patched`, WKWebView:** end 199 px short of the control in both runs, which is two wheel steps, with no frame moving backwards. Their prepend preservation seems to restore an offset measured before the page landed, which drops the wheel input that arrived in between. They pass in Chromium and Playwright WebKit, where the wheel scroll is applied on the main thread. The two patches do not touch the prepend path.
- **`v1s` with `preserveScrollOnPrepend={false}`** (the viewport's own switch for this) does not fix it. Without the library's prepend detection it treats the page as new items and scrolls to a new turn's anchor: the reader ends 19,900 px off in Chromium and WKWebView, and P1 drifts by 29,000 px.
- **`v2`:** passes in this run (end 0.3 px). Its WKWebView cell differed by 100 px in the previous rerun, so treat it as unstable.

### 4.3 P3: an image, a code block, or a fold above the reader

v0 fails in every engine:

- the image: not measurable after #980 (the frame is fixed-height);
- the code block: 228 px;
- the fold: 345–691 px.

It passes only where the target ended outside Virtuoso's 400 px overscan, because there the change is measured later, off screen. This confirms S6 and S11.

`v1`, `v1s` and `v1s-patched` hold within 0.3 px in every engine, after scrolling up and after scrolling down. That includes the automatic fold when a turn ends above the reader's place (S11), with no row anchor at all.

`v2` passes in all three engines in this run (an earlier run of the rig had it drifting 228 px on the code block in both WebKits).

### 4.4 P4: following, release and jump

- **v0:** the bottom gap reaches 440–462 px while streaming in every engine (S10 plus re-measurement). A downward wheel releases follow. The jump lands in 1–3 frames, but the gap returns to 106–516 px afterwards.
- **`v1`:** the gap stays 0 px on every frame, including the end-of-run fold (about 4,400 px in this case). A 120 px wheel up releases and stays released. The jump lands in 1 frame (3 frames in one of four WKWebView runs, under load). A downward wheel keeps following.
  - The first version re-engaged follow whenever a scroll event found the reader at the bottom. That failed in one of two runs in each WebKit. WebKit applies a wheel on its scrolling thread and delivers the DOM wheel event later, so a follow write can land at the bottom in between, and the rule re-pinned a reader who had just left.
  - The fix re-engages only after the reader's own downward input (wheel down, scroll keys, scrollbar) or the jump. This is S4 again: whichever owner #461 ships has to encode it.
- **`v1s`** fails on two behaviours in the library's source:
  - The Viewport and Content ResizeObservers call `requestAnimationFrame(handleResize)` instead of following inside the callback, so follow is a frame late at each new row: gap spikes of 48–66 px.
  - The Viewport's `onWheel` calls `userScrollIntent()` before the user's handler, for any wheel direction. A downward wheel or momentum at the bottom sets "free-scrolling" and produces no scroll event to re-engage, so follow stays off while content streams in.
  - A new turn settles near the top, which the owner accepted. Its bottom-padding gap was a rig layout issue and was fixed before these runs.
- **`v1s-patched`** changes exactly those two things. The gap is 1 px in Chromium and 2 px in WKWebView (the line is 1), and a downward wheel keeps following in every engine. The upward release holds in WKWebView but did not hold in Chromium or Playwright WebKit in the matrix, so the cell fails. A repeat of the Chromium case (6 runs, committed as `chromium-p4-release-repeat.json`) held in 4 and re-pinned in 2. The library re-engages follow when a scroll event finds the reader near the end (`reconcileFollowMode`), the rule `v1`'s first version had; that is the likely cause, and it was not isolated. `v1s` also held in 4 of 6, and `v1` in 6 of 6.
- **`v2`:** a 0 px gap in every engine. Its wheel-up release did not hold in WKWebView and Playwright WebKit.

### 4.5 P5: open at the tail

v0 fails. What the user sees on open, by frame:

- **Chromium:** the list is hidden for one frame. The first visible frame is the tail's, 737 px short of the end, at 133 ms.
- **WKWebView and Playwright WebKit:** one hidden frame, then one visible frame 2,173 px short of the end, then the tail, 134 ms and 248 ms after mount in WKWebView.

`v1`, `v1s`, `v1s-patched` and `v2` are at the end on the first visible frame in every engine. `v2` shows two hidden frames first. `v1`'s first visible frame comes later (342 ms in Chromium, 553 ms in WKWebView), because the whole window mounts first. That is P6.

### 4.6 P6: cost

**Mount.** `v1`, `v1s` and `v1s-patched` mount every row (profiling build).

| Mount to the first frame at the end, median ms | Chromium v0 | Chromium v1 | WKWebView v0 | WKWebView v1 |
| --- | ---: | ---: | ---: | ---: |
| 10 groups | 115 | 146 | 243 | 127 |
| 20 groups | 116 | 212 | 251 | 191 |
| 40 groups | 133 | 342 | 248 | 553 |
| 400 groups | 269 | 2,614 | 393 | 3,868 |

In WKWebView, v0's numbers after #980 are inflated by the delayed tail (4.8), so `v1` looks better at 10 and 20 groups than it did against the old v0. At 40 groups it still misses the 15 ms rule by a wide margin. The two remedies, in the same build:

| 40 groups, median ms | Chromium | WKWebView | Anchoring (P1, P1 at 0, P3) |
| --- | ---: | ---: | --- |
| v0 | 133 | 248 | fails P3 |
| v1 | 342 | 553 | holds |
| v1 + `content-visibility: auto` on rows | 252 | 344 | Chromium holds. **WebKit breaks:** 347 px at offset 0, 1,770 px and 1,440 px on the fold |
| v1 + progressive mount (newest six rows, then twelve per task) | **96** | **64** | holds in both engines; P4 and P5 pass too |

**Tail-first, scored to completion.** The first-paint numbers above stop at the first frame showing the tail. The rest of the window is still landing after that, so this run also records the time the whole window is in, the longest main-thread block per slice (a MessageChannel loop; the gap a tick arrives late is the longest task between), and the cases below started with no settle wait.

| Variant, window | Engine | Tail visible, ms | Whole window in, ms | Longest first mount, ms | Longest slice, ms | Commits |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| v1 + progressive, 40 groups | Chromium | 96 | 915 | 35 | 171 | 18 |
| | WKWebView | 64 | 870 | 14 | 180 | 18 |
| | Playwright WebKit | 118 | 1,171 | 43 | 167 | 18 |
| v1 + progressive, 400 groups | Chromium | 232 | 21,530 | 36 | 146 | 176 |
| | WKWebView | 181 | 17,945 | 51 | 1,347 | 176 |
| | Playwright WebKit | 198 | 24,848 | 125 | 2,090 | 176 |
| v1s-patched + progressive, 40 groups | Chromium | 92 | 832 | 31 | 109 | 18 |
| | WKWebView | 84 | 1,019 | 37 | 177 | 18 |

The correction to the first version of this report is in the first row: tail-first gets the tail on screen fast, but the window takes about a second to complete at 40 groups, a slice blocks the main thread for 110–180 ms, and at 400 groups it takes 18–25 s with WebKit slices of 1.3–2.1 s. A step of twelve rows is too large to count as incremental, and the 400-group case is one more reason for the bounded window. These are single runs per cell under load, so the exact slice times will move; the order of magnitude should not.

**P1–P4 while slices still land** (the "E-" cases in the raw results; the scenario starts as soon as rows exist). Tail-first variants only; the full tables are in section 2.

| Case | Chromium | WKWebView | Playwright WebKit |
| --- | --- | --- | --- |
| P1 mid-history | pass 0.6 px | pass 0.6 px | pass 0 px |
| P1 at offset 0 | **fail** 3,437 px | **fail** 75,984 px | **fail** 3,437 px |
| P2, movement against the wheel (control) | pass 0.2 px (0.1) | pass 0.5 px (0.5) | pass 0 px (1) |
| P3 code, fold (up) | pass 0, 0.3 px | pass 0, 0.3 px | pass 0, 0 px |
| P4 follow, release, jump, wheel down | pass | pass | pass |

For `v1s-patched` + progressive, the same cases fail more: P2 moves 100 px against the wheel in Chromium, P3's fold drifts 277 px and P4's release does not hold in WKWebView. Its P1 at offset 0 cell is not comparable (the library moved the reader off 0 before the page landed).

**Scripted scroll at 400 groups.** In WKWebView, `v0` and `v2` hold 60 fps. `v1` ran at 59.6 and 22.9 fps in its two runs, `v1s` at 51.5 and 23.6, and `v1s-patched` at 29.8 (the second run lost its web process). In Chromium, `v1`, `v1s` and `v1s-patched` reach 39–44 fps with 67–83 ms p95 frames; v0 and `v2` hold 60 fps. Playwright WebKit holds 60 fps for every variant. The machine was loaded, and an earlier run of the rig saw one 26 fps run in seven for `v1`, so this needs a quiet session before it is a finding.

**Chunk cost.**

| React render per chunk, p95 ms | Chromium 40 | Chromium 400 | WKWebView 40 | WKWebView 400 | Playwright WebKit 40 | Playwright WebKit 400 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| v0 | 7.7 | 11 | 12 | 13 | 12 | 14 |
| v1 | 7.8 | 38 | 11 | 27 | 8 | 26 |
| v1s | 7.7 | 48 | 10 | 54 | 8 | 24 |
| v1s-patched | 8 | 41 | 11 | 32 | 8 | 24 |
| v2 | 5.2 | 8.4 | 7 | 10 | 6 | 12 |

At 40 groups the list does not change the chunk cost much. The 8 ms line fails in WebKit for v0 as well, so the remaining cost is in the rows and the turn model, not the list.

At 400 groups, every mounted row holds several store subscriptions (time marker, message, slice selectors) that run on each update. The write-to-DOM latency then reaches 150–280 ms, and the stream fell behind: 19–38 of 151 chunks committed in 5 s, against 133–151 for v0 and `v2`. This is the case for #462's bounded window, measured.

### 4.7 P7: trackpad momentum

**Not run. It needs a person with a trackpad.** The page has a mode for it, `?v=v1&manual=1`, served with `--serve`: pages land as the reader nears the top, and the readout shows the largest single-frame step at each load.

As a proxy, the WKWebView harness sends trackpad flicks with momentum phases. Each flick has five finger frames, then a decaying momentum tail. The results, for two page loads per run and two runs per variant (profiling build):

| | Main-thread stall while the page mounts | Largest single-frame step after the page |
| --- | ---: | ---: |
| v0 | 34–35 ms | anchor row unmounted mid-flick; not measurable |
| v1 | 206–234 ms | 706–765 px |
| v1s | 289–345 ms | 879–929 px |
| v1s-patched | 200 ms (one run) | 398 px |
| v2 | 49–54 ms | anchor row unmounted; not measurable |

A lost anchor would show as a step the size of the page (15,000–17,000 px). That never happened for the plain-row variants.

The large step needs care. During the stall, WebKit kept scrolling on its scrolling thread, and the main thread then caught up in one frame. On screen that may be smooth, with the step only in the main thread's view, or it may be a visible hitch. Only the manual run can tell.

The stall itself is real, and #461 can remove it the same way as the mount: land a history page in slices instead of one 51-message commit. 4.6 shows what slicing costs and leaves open (slices of 110–180 ms at twelve rows, and the offset-0 drift).

### 4.8 What #980 did to v0

This section replaces an earlier before/after comparison of two different sessions. It is one same-session A/B in plain `react-dom`, in Chromium and WKWebView: v0 with the source at 2ff3560b (before #980, with the rig's v0 composed as it was then: no `scrollToBottomOnRunStart` or `scrollToBottomOnInitialize`, no pin-driven scroll button) against v0 with the source at 33a906d5 (#980) and the rig's current v0. `v1` runs in both builds as the control. The rounds alternate pre, post, pre, post, three repetitions each, so every cell has six P2 runs per case and ten opens. The one-minute load average at the end of the rounds was 19–22 in Chromium, and 31, 19, 11 and 12 in WKWebView.

#### Chromium (React build: plain)

| Property | v0@pre980 | v1@pre980 | v0@post980 | v1@post980 |
| --- | --- | --- | --- | --- |
| P1 | pass 0 px | pass 0.2 px | pass 0 px | pass 0.2 px |
| P1 at offset 0 | **fail** anchor lost, parked at 0/0/0/0/0/0 px | pass 0.2 px, parked at 0/0/0/0/0/0 px | **fail** anchor lost, parked at 0/0/0/0/0/0 px | pass 0.2 px, parked at 0/0/0/0/0/0 px |
| P2 | pass end 0 px, against 0 px (control 0 px) | pass end 0.2 px, against 0.2 px (control 0 px) | **fail** end 0 px, against 1191 px (control 1191 px) | pass end 0.2 px, against 0.2 px (control 0 px) |
| P5 | **fail** first visible frame 2056 px short of the end, 1 visible fr before the end, 0 hidden fr | pass at the end on the first visible frame (0 hidden fr) | **fail** first visible frame 737 px short of the end, 0 visible fr before the end, 1 hidden fr | pass at the end on the first visible frame (0 hidden fr) |
| P5 first visible / tail ms | – 126.6 / 142.8 ms | – 322.8 / 322.8 ms | – 121.1 / 121.1 ms | – 314.6 / 314.6 ms |
| P6 mount 40 | pass 142.8 ms (v0 142.8) | **fail** 322.8 ms (v0 142.8) | pass 121.1 ms (v0 121.1) | **fail** 314.6 ms (v0 121.1) |
| P6-open-10 median ms | 112.4 | 138.4 | 110.2 | 141.4 |
| P6-open-20 median ms | 127.4 | 203.4 | 106.7 | 203.7 |

#### WKWebView (Safari 27 WebKit) (React build: plain)

| Property | v0@pre980 | v1@pre980 | v0@post980 | v1@post980 |
| --- | --- | --- | --- | --- |
| P1 | pass 0 px | pass 0.3 px | pass 0 px | pass 0.3 px |
| P1 at offset 0 | **fail** anchor lost, parked at 0/0/0/0/0/0 px | pass 0.7 px, parked at 0/0/0/0/0/0 px | **fail** anchor lost, parked at 0/0/0/0/0/0 px | pass 0.7 px, parked at 0/0/0/0/0/0 px |
| P2 | **fail** end 210 px, against 1191 px (control 1191 px) | pass end 0.7 px, against 0.3 px (control 0 px) | **fail** end 292 px, against 1191 px (control 1191 px) | pass end 0.3 px, against 0.3 px (control 0 px) |
| P5 | **fail** first visible frame 883 px short of the end, 0 visible fr before the end, 0 hidden fr | pass at the end on the first visible frame (0 hidden fr) | **fail** first visible frame 2173 px short of the end, 1 visible fr before the end, 1 hidden fr | pass at the end on the first visible frame (0 hidden fr) |
| P5 first visible / tail ms | – 87 / 87 ms | – 463 / 463 ms | – 113 / 216 ms | – 461 / 461 ms |
| P6 mount 40 | pass 87 ms (v0 87) | **fail** 463 ms (v0 87) | pass 216 ms (v0 216) | **fail** 461 ms (v0 216) |
| P6-open-10 median ms | 75 | 127 | 170 | 159 |
| P6-open-20 median ms | 67 | 220 | 146 | 212 |

#### What the A/B shows

- **#980 introduced the upward-wheel jump in Chromium.** v0 before #980: the P2 control and page runs both move 0 px against the wheel, in all twelve runs. After #980: both move 1,191 px against the wheel, in all twelve. The page plays no part, since the control has no page. Finding 1 of the review is right, and 4.2 no longer blames prepends. `v1` is clean in both builds.
- **#980 did not introduce the jump in WKWebView.** The control jumps before and after (92 to 1,191 px, varying), and the end positions scatter in both builds. The wheel path in v0 is unreliable in WebKit independent of #980.
- **#980 delays the tail in WKWebView by about 130 ms.** The median open to the tail is 87 ms before (range 71–103) and 216 ms after (range 100–249). The first visible frame moves from 87 to 113 ms, so the list is not blank for 130 ms more. It paints the list 2,173 px short of the end for the extra stretch (one hidden frame and one visible frame at the wrong place, over about 100 ms), then shows the tail. Before #980 the first visible frame already showed the tail's last row. `v1` is 463 and 461 ms in the two builds, unchanged. At 10 and 20 groups the delay is 75 to 170 ms and 67 to 146 ms.
- **In Chromium #980 did not delay the open.** The tail comes at 143 ms before and 121 ms after (the list is hidden for one frame, then the tail is 737 px short of the end; before, the first visible frame was 2,056 px short).
- **The "45,476 px short" frame in the earlier version of this report was a frame where v0's list was still `visibility: hidden`.** The probe counted any frame without the last row visible as hidden, and recorded the gap at the first frame with rows in the DOM, not the first visible one. The probe now records real visibility. 45,476 is v0's `scrollTop` when it first paints, and the gap at that frame is 737 px.

#461 removes this path: `v1` opens at the end on the first visible frame. If #461 slips, the interim fix the improvement plan mentions (position at the tail before the first paint) matters more for WebKit after #980 than before it, and a P2 check on the plain wheel path (the Chromium jump) belongs with it.

## 5. What #461 should take from this

### 5.1 The path

Go ahead with step 3 of the migration plan, with `v1`'s design, and one addition to it. Two changes to the plan:

- **Mount the tail first, and land history pages the same way**, with two corrections to the earlier version of this advice. The tail is on screen at 64–96 ms (4.6), faster than v0. But the slices still cost 110–180 ms each at twelve rows, so the slice size needs its own measurement before the plan fixes it. And while slices land, a reader at offset 0 is not anchored: the owner has to re-anchor per slice there, as it does for a page, or hold slices while the reader is at the top. This is safe otherwise because anchoring is on.
- **Make #462's bound part of the same release**, not a later step. At 400 loaded groups, mounting costs 9–10× v0, and a chunk's render 2–3× with 6–13× the latency. The rig's numbers put a comfortable cap at the daemon's 40-group page, plus one or two pages while the reader is scrolled up.

**Hand-written owner against a patched Message Scroller.** The project rule is to adopt shadcn's component unless it lacks something we need. The component does lack three things, found after two small patches closed the first two gaps:

| | Own owner (`v1`) | Message Scroller 0.3.1, two patches (`v1s-patched`) |
| --- | --- | --- |
| P4: follow within 1 px, a downward wheel keeps following | passes | passes after the patches (1–2 px gap) |
| P4: upward release holds | passes in 6 of 6 | held in 4 of 6 in Chromium, and not in the Playwright WebKit run |
| P1 at offset 0 | passes | 42 px in every engine |
| P2 in WKWebView | passes | 199 px short of the wheel |
| P3 | passes | passes |
| Mount, one shot / tail-first (Chromium, WKWebView) | 342, 553 / 96, 64 ms | 330, 424 / 89, 93 ms |
| Tail-first with slices landing (P2, P3, P4) | passes in every engine | fails in WKWebView (P3 fold 277 px, P4 release) and Chromium (P2, 100 px) |
| Code we maintain | `shells/scroll-owner.ts`, 109 lines, plus `lists/progressive.ts`, 34 lines | the vendored source, 2,726 lines in 10 files, of which about 25 lines are ours; plus 23 lines of row glue and `lists/progressive.ts`; the unpatched gaps above would need more patches |

So a patched Message Scroller does **not** pass everything `v1` passes, and the recommendation stays `v1`. The mount cost is not what separates them: the two are within 30 ms of each other tail-first, in both engines. The gap is correctness in the cases the rig added to the spec (offset 0, mid-wheel in WebKit, release after a downward wheel). The three remaining failures need changes in the library's prepend restore (it drops wheel input in WebKit, and moves the reader at offset 0), and in how it re-engages follow. They are not small flag changes. The `preserveScrollOnPrepend` switch does not help (4.2).

Two things the owner should take from the library regardless: the patched behaviours above (follow inside the observer callback; release only on upward input) are what `v1` does, so the rig found the same two rules independently. And it is worth filing the findings upstream: the rAF follow and any-direction wheel release (with the two patches in `vendor/`) and the WKWebView prepend restore.

It also brings 20 KB of minified library, where the owner is 109 lines. Message Scroller's code remains a useful reference for edge cases. `v1` needed two fixes the rig found, and the library may already handle cases the rig does not cover.

### 5.2 What the owner must encode

The rig found each of these:

1. **Follow by writing `scrollTop` in the resize callback.** P4 shows a 0 px gap. v0's frame-late follow reaches 440–462 px, and Message Scroller's rAF follow 48–66 px.
2. **Release on upward reader input. Re-engage only on downward reader input or the jump**, never on "a scroll event at the bottom". WebKit's wheel event arrives after its threaded scroll.
3. **At offset 0, re-anchor once on the reader's block**, not the first visible row. A page that completes a cut turn regroups the top rows. A tail-first slice at offset 0 needs the same.
4. **Compute row indexes once in the list.** Do not carry over `VirtualMessage`'s per-row `findIndex` and `statusAnchorId`.
5. **No `content-visibility` on rows.** WebKit loses anchoring with it.
6. **Keep the row anchor deleted.** The automatic fold above the reader held within 0.3 px with no row anchor, in every engine. This covers the fold that happens by itself. A fold or expand the user clicks above or below the reader was not measured.

### 5.3 The rig as a regression gate

The rig runs in about 30–60 minutes per engine under load, with no app and no daemon. The Chromium half could run in CI. The WKWebView half needs a logged-in macOS session with a screen, so it is a manual pre-release check. The UI package's `typecheck` and `lint` scripts now include the rig, so the rig's TypeScript and driver code are checked by the existing CI jobs.

## 6. What was not tested

- **Safari 27 itself.** `safaridriver` needs "Allow remote automation" turned on in Safari's settings, so WebKit was measured in a plain `WKWebView` on the same system WebKit, with no Tauri shell.
- **P7 by hand.** Only the synthesized-momentum proxy ran.
- **The real app.** Rows, markdown and the turn model are production code. The composer is a fixed-height stand-in, and the scroll-fade mask, gates, queue, find, sub-agent tabs and Activity jumps are absent. `v1` places the composer below the scroller; #461 has to decide that (S3).
- **Real transcripts.** The fixture is synthetic: Claude-shaped turns, with no Codex shapes, attachments or permission gates.
- **`v2`'s real row model.** Its rows come from the fixture's message cut.
- **Older WebKit** (macOS 14 and earlier, without anchoring). `v1`'s fallback for engines without `overflow-anchor` is written but untested.
- **Jumps and find** (S14, S15) and **sub-agent views** (S19).
- **A fold or expand the user clicks.** Only the automatic fold at a turn's end was measured, above the reader.
- **Slice size.** Tail-first used six rows, then twelve per task. Other sizes were not tried.
- **A quiet machine.** Every number was taken with the machine loaded; mount and slice times will be lower, and the 400-group figures are single runs.
- **Recordings.** Results are numbers only. No screen recording was made.

The WKWebView harness lost its web process several times ("Completion handler for function call is no longer reachable"), mostly in `v1`, `v1s` and `v1s-patched` runs at 400 groups or while streaming, and in `v1` mount runs. The driver times out, restarts the harness, retries once and records the case as an error. Those cases are absent from the tables where every repetition failed. The `Errors` line under each engine's table in `summarize.mjs` output lists them, and the raw JSON keeps them.

## 7. Open questions

1. **Is the main thread's catch-up step visible during momentum?** The manual P7 run answers this. If it is visible, slicing history pages (5.1) is required, not optional.
2. **Where should the composer go?** It sits below the scroller in `v1`. Keeping it sticky inside the scroller, as today (S3), was not measured with browser anchoring.
3. **What cap should #462 use?** The rig suggests the 40-group page plus one or two pages. #462 should measure it on real chats.
4. **How small must a tail-first slice be?** Twelve rows block for 110–180 ms here. A smaller step or a per-slice time budget would trade a longer total against smoother frames.
5. **Should Chromium run the rig in CI**, and against what time budget?
6. **Should the Message Scroller findings go upstream?** The rAF follow, the any-direction wheel release, and the WKWebView prepend restore that drops wheel input (a 200 px loss in P2, which did not reproduce in Chromium or Playwright WebKit).

## 8. Reproducing

```sh
pnpm install
pnpm --filter @qlan-ro/mainframe-types build
pnpm --filter @qlan-ro/mainframe-e2e exec playwright install chromium webkit
R=packages/ui/benchmarks/transcript-list/driver

# The main matrix (React profiling build, the default): sections 2 and 4.
for e in chromium wk webkit; do
  node $R/run.mjs --engines $e --variants v0,v1,v1s,v1s-patched,v2 --repeat 2 --out matrix-$e.json
done
# Tail-first scored to completion, P1-P4 while slices land, and the content-visibility run.
node $R/run.mjs --no-build --engines chromium,wk,webkit --variants v1+progressive,v1s-patched+progressive --cases E-,P6-tail,P5 --repeat 2 --out tail.json
node $R/run.mjs --no-build --engines chromium,wk --variants v1+cv --cases P1,P3,P5 --repeat 2 --out cv.json
node $R/run.mjs --no-build --engines chromium,wk --variants v1s+nopreserve,v1s-patched+nopreserve --cases P1,P2,P4 --repeat 2 --out nopreserve.json

node $R/summarize.mjs matrix-*.json tail.json cv.json nopreserve.json
```

The committed [`results/`](../../packages/ui/benchmarks/transcript-list/results/README.md) files are these runs joined per engine, in the same order. `--no-build` reuses the build of the first command, so run it with the same working folder (`--work`).

**The 4.8 A/B** uses plain `react-dom` (`RIG_PROFILE=0`) and two builds of the page. Build the rig once at 2ff3560b (with the rig directory copied in and `shells/V0Shell.tsx` taken from commit 77021cddf) and once at the branch, each into its own `--work` folder, then run both with a tag, alternating, and summarize them together:

```sh
RIG_PROFILE=0 node $R/run.mjs --work /tmp/rig-pre --engines chromium,wk --variants v0,v1 --cases P1,P2,P5,P6-open-10,P6-open-20 --repeat 3 --tag pre980 --out ab-pre.json
RIG_PROFILE=0 node $R/run.mjs --work /tmp/rig-post --engines chromium,wk --variants v0,v1 --cases P1,P2,P5,P6-open-10,P6-open-20 --repeat 3 --tag post980 --out ab-post.json
node $R/summarize.mjs ab-pre.json ab-post.json
```

A full matrix takes 30–60 minutes per engine, depending on load. `--variants v1,v1+progressive --cases P5,P6` narrows a run. `--serve` serves the page for the manual P7 run (`?v=v1&manual=1`). The `wk` engine opens a borderless 1280×720 window at the bottom-left of the screen for the duration of the run.
