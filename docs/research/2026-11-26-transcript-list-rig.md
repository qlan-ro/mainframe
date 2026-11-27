# Transcript list proof rig: P1–P7 in Chromium and WebKit (26 November 2026)

Todo #455. It decides which path #461 takes. The proof spec is section 4.5 of the architecture review's part 2, which is kept outside the repository. The rig is [`packages/ui/benchmarks/transcript-list/`](../../packages/ui/benchmarks/transcript-list/README.md). Everything here ran on a synthetic chat (`@assistant-ui/react` 0.15.38, react-virtuoso 4.18.24, React 19.3.1). No app, daemon, or real transcript was involved.

**What the numbers are.**

- **Branch and `v0`.** The tables come from one rerun on the branch after it was rebased onto #980 (todo #456), so `v0` mirrors the viewport as it is after #980. That change turns off assistant-ui's remaining scroll controllers, drives the scroll-to-bottom button from the pin, and gives every markdown image a fixed-height frame. Since then images no longer change the transcript's height, so the P3 image case measures nothing for `v0`.
- **React build.** Every table names the React build it was measured with. The main matrix and everything in it use React's profiling build (`<Profiler>` needs it for the P6 chunk row). Only the same-session A/B in 4.8 uses plain `react-dom`. A table never mixes the two, and the two builds' mount times are not comparable with each other.
- **Raw results.** [`results/`](../../packages/ui/benchmarks/transcript-list/results/) holds the JSON behind every cell (`matrix-*.json`, `ab-980-*.json`, and `chromium-p4-release-repeat.json` for the release repeat in 4.4), without machine paths, with the load average at the end of each part. Section 8 reproduces them.
- **Load.** The machine was heavily loaded by other work (12 cores, load average 10–30 during the runs; per part in the JSON). Repetitions are modest: two per cell (one in Playwright WebKit), five opens per mount size. Compare cells within a table, not across the two builds or across sessions. Absolute mount times here are higher than in a quiet session.

## 1. Short answer

**Update, section 9:** a short first window with the reader at the top (S-top) found a case `v1` as merged fails in WKWebView, a page landing near offset 0 during a momentum flick. The recommendation stays `v1`, with that hole to close first.

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
  - It still fails what `v1` passes: a page landing above a reader at offset 0 (42 px in every engine), a page landing mid-wheel in WKWebView (200 px short of the wheel), and an upward release that held in 4 of 8 Chromium runs (the matrix's 2 plus 6 repeats). `preserveScrollOnPrepend={false}` is not a way out: the library then reads a prepend as a new turn and scrolls to it (a 29,000 px jump).
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
- **`v1s-patched`** changes exactly those two things. The gap is 1 px in Chromium (at the line) and 2 px in WKWebView (over it, so WKWebView P4 fails on the gap), and a downward wheel keeps following in every engine. The upward release holds in WKWebView but did not hold in Chromium or Playwright WebKit in the matrix, so the cell fails. Across the matrix's two Chromium runs and a repeat of 6 (committed as `chromium-p4-release-repeat.json`), the patched scroller held in 4 of 8, `v1s` in 4 of 8 and `v1` in 8 of 8 (matrix 0, 0, 2 of 2; repeat 4, 4, 6 of 6). The cause is in the library's own logic, not in the patches: Chromium delivers the wheel event and then the library's own follow-write scroll event in the same frame, and `reconcileFollowMode`'s arm-at-end branch (`use-message-scroller-controller.ts`, lines 160–173) re-engages follow. The reader's scroll then cannot release it, because `autoscrollingRef` blocks release for 180 ms after each follow write. That is the rule `scroll-owner.ts` (lines 9–12) rejects, and `v1`'s first version had it. This was read from the source and fits the runs; it was not instrumented.
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
- **#980 delays the tail in WKWebView by about 130 ms.** The median open to the tail is 87 ms before (range 71–103) and 216 ms after (range 100–249). v0's WKWebView opens after #980 are bimodal: three at 100–110 ms and seven at 175–249 ms (the median of 216 sits in the upper mode). The first visible frame moves from 87 to 113 ms, so the list is not blank for 130 ms more. It paints the list 2,173 px short of the end for the extra stretch (one hidden frame and one visible frame at the wrong place, over about 100 ms), then shows the tail. Before #980 the first visible frame already showed the tail's last row. `v1` is 463 and 461 ms in the two builds, unchanged. At 10 and 20 groups the delay is 75 to 170 ms and 67 to 146 ms.
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
| P4: follow within 1 px, a downward wheel keeps following | passes | a downward wheel keeps following after the patches; the gap is 1 px in Chromium and 2 px in WKWebView (fails the 1 px line there) |
| P4: upward release holds | passes (8 of 8 Chromium runs) | held in 4 of 8 Chromium runs, and not in the Playwright WebKit run |
| P1 at offset 0 | passes | 42 px in every engine |
| P2 in WKWebView | passes | 199 px short of the wheel |
| P3 | passes | passes |
| Mount, one shot / tail-first (Chromium, WKWebView) | 342, 553 / 96, 64 ms | 330, 424 / 89, 93 ms |
| Tail-first with slices landing (P2, P3, P4) | passes in every engine | fails in WKWebView (P3 fold 277 px, P4 release) and Chromium (P2, 100 px) |
| Code we maintain | `shells/scroll-owner.ts`, 109 lines, plus `lists/progressive.ts`, 34 lines | the vendored source, 2,726 lines in 10 files, of which about 25 lines are ours; plus 23 lines of row glue and `lists/progressive.ts`; the unpatched gaps above would need more patches |

So a patched Message Scroller does **not** pass everything `v1` passes, and the recommendation stays `v1`. The mount cost is not what separates them: the two are within 30 ms of each other tail-first, in both engines. The gap is correctness in the cases the rig added to the spec (offset 0, mid-wheel in WebKit, the upward release). The three remaining failures need changes in the library's prepend restore (it drops wheel input in WebKit, and moves the reader at offset 0), and in how it re-engages follow (the upward release). They are not small flag changes. The `preserveScrollOnPrepend` switch does not help (4.2).

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

The rig runs in about 30–60 minutes per engine under load, with no app and no daemon. The Chromium half could run in CI. The WKWebView half needs a logged-in macOS session with a screen, so it is a manual pre-release check. The UI package's `typecheck` and `lint` scripts now include the rig. CI runs only `typecheck` for the UI package (no lint step), so CI type-checks the rig's TypeScript (`driver/*.mjs` is outside its tsconfig and is not type-checked). `lint` covers the rig, including the driver, when run locally with `pnpm --filter @qlan-ro/mainframe-ui lint`; adding it to CI needs a workflow change, which this PR does not make.

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

The release repeat in 4.4 (`results/chromium-p4-release-repeat.json`) is `node $R/run.mjs --no-build --engines chromium --variants v1s-patched,v1s,v1 --cases P4-wheel-up --repeat 6 --out chromium-p4-release-repeat.json`, run in the profiling build after the matrix.

A full matrix takes 30–60 minutes per engine, depending on load. `--variants v1,v1+progressive --cases P5,P6` narrows a run. `--serve` serves the page for the manual P7 run (`?v=v1&manual=1`). The `wk` engine opens a borderless 1280×720 window at the bottom-left of the screen for the duration of the run.

## 9. S-top: a short first window, the reader at the top (27 November 2026)

The owner hit a scroll problem the proof never tested. A tool-heavy chat opens with a first window shorter than the screen, so the reader reaches the top at once, and an older page lands while they are still scrolling at or near offset 0. P1-top passes `v1` only with the reader parked, no input during the landing. Everything in this section is **WKWebView only** (the engine the app ships), **one repetition per cell**, on a loaded machine (load average 6.2, recorded and not waited out), so read a single cell as a sign, not a rate. Chromium and Playwright WebKit were run on a smaller set while building the case (`v1` and `v1s-patched` held on `window=2` in Chromium); they are not in the table. The full cross-engine run, `v2` and `v1+progressive` are left for the end of the plan.

### 9.1 The scenario

- **Opening.** Two shapes. `window=2` opens with the newest two messages (2.2 to 2.5 viewports here, the reader at the tail). `shape=real` is the measured shape of a real first window: the newest 80 items, two folded tool-heavy turns (33 tool calls, 5 texts, 2 thoughts; 24 tool calls, 5 texts, 5 thoughts) between five short user messages, about 1.3 viewports, with older pages of 80 items that add about one viewport each (`fixture-real.ts`, no real content). `window=2` runs both walking up from the tail and parked at offset 0 first.
- **Input.** The reader wheels up continuously: fixed −60 px steps, fixed −300 px steps, and two momentum flicks with the harness's real `NSEvent` phases.
- **Landing.** The app's own rule requests the page (`EarlierMessages` `useOlderPageGesture`: an upward gesture fires the load once the reader is within a viewport of the top, and a window shorter than the viewport has no scroll events, so the gesture itself fires it). The page arrives 60 ms ±30% later, while the wheel continues. The reader keeps going afterwards, so in the real shape a page can land at the top again; each landing is scored on its own.
- **Score.** The anchor is the block under the viewport centre when the page is requested; the baseline is the last frame before the landing shows. After removing the wheel's own deltas (a ledger of the page's `wheel` events, with the browser clamping the wheel at the top of the old content before the landing and at the top of the new page after it), the content under the reader must move ≤ 2 px, must never be lost (an unmounted anchor counts as lost, not as a missing sample; an anchor that leaves the viewport stays a number), and the reader must not end at the top of the new page (`pinned`). `loads` is recorded. Lag between a wheel event and the frame that shows its scroll differs per event, so the ledger takes the best fit over how many events the browser had applied (a prefix); that forgives a jump no larger than the wheel step in flight. Its own error is measured by `S-noise` (the same input with no landing): 0 px for every variant but `v0` in every input, so flicks use the same 2 px line. `v0`'s flick control (1,136 px) is its virtualizer unmounting the anchor, not ledger error.
- **The readout.** The manual readout (`?manual=1`) dropped non-finite samples (`Number.isFinite` filter), so a lost anchor never showed. It now counts a missing anchor as a jump and prints `lost`.

### 9.2 Results

| Case                                     | v0                                                                                  | v1                                            | v1s                                               | v1s-patched                                       | v1+fix                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| window=2, from the tail, -60 px steps    | **fail** jump lost, end 18.1, anchor lost 7 fr (bottom gap 18), pinned 0, loads 1   | pass jump 0.2, end 0.2, pinned 0, loads 1     | **fail** jump 59.2, end 0.8, pinned 0, loads 1    | **fail** jump 59.2, end 0.8, pinned 0, loads 1    | pass jump 0.8, end 0.8, pinned 0, loads 1         |
| window=2, from the tail, -300 px steps   | **fail** jump lost, end lost, anchor lost 18 fr (bottom gap 127), pinned 0, loads 1 | pass jump 0.2, end 0.2, pinned 0, loads 1     | pass jump 0.2, end 0.2, pinned 0, loads 1         | pass jump 0.2, end 0.2, pinned 0, loads 1         | pass jump 0.8, end 0.8, pinned 0, loads 1         |
| window=2, from the tail, momentum flicks | **fail** jump lost, end 111, anchor lost 7 fr (bottom gap 111), pinned 0, loads 1   | pass jump 0.2, end 0.2, pinned 0, loads 1     | **fail** jump 240.2, end 218.2, pinned 0, loads 1 | **fail** jump 242.2, end 219.2, pinned 0, loads 1 | **fail** jump 168.2, end 134.2, pinned 0, loads 1 |
| window=2, parked at 0, -60 px steps      | **fail** jump lost, end 651, anchor lost 1 fr (bottom gap 891), pinned 0, loads 1   | pass jump 0.8, end 0.8, pinned 0, loads 1     | **fail** jump 17.2, end 17.2, pinned 0, loads 1   | **fail** jump 17.2, end 17.2, pinned 0, loads 1   | pass jump 0.8, end 0.8, pinned 0, loads 1         |
| window=2, parked at 0, -300 px steps     | **fail** jump lost, end 9, anchor lost 1 fr (bottom gap 891), pinned 0, loads 1     | pass jump 0.8, end 0.8, pinned 0, loads 1     | **fail** jump 42.8, end 42.8, pinned 0, loads 1   | **fail** jump 42.8, end 42.8, pinned 0, loads 1   | pass jump 0.8, end 0.8, pinned 0, loads 1         |
| window=2, parked at 0, momentum flicks   | **fail** jump lost, end 836, anchor lost 1 fr (bottom gap 891), pinned 0, loads 1   | pass jump 0.8, end 0.8, pinned 0, loads 1     | **fail** jump 21.2, end 9.2, pinned 0, loads 1    | **fail** jump 30.8, end 30.8, pinned 0, loads 1   | pass jump 0.8, end 0.8, pinned 0, loads 1         |
| real shape, -60 px steps                 | **fail** jump lost, end 196, anchor lost 40 fr (bottom gap 359), pinned 0, loads 5  | pass jump 0, end 0, pinned 0, loads 4         | pass jump 0, end 0, pinned 0, loads 4             | pass jump 0, end 0, pinned 0, loads 4             | **fail** jump 60, end 60, pinned 0, loads 4       |
| real shape, -300 px steps                | **fail** jump lost, end lost, anchor lost 13 fr (bottom gap 115), pinned 1, loads 2 | pass jump 0, end 0, pinned 0, loads 2         | **fail** jump 28, end 28, pinned 0, loads 2       | **fail** jump 28, end 28, pinned 0, loads 2       | pass jump 0, end 0, pinned 0, loads 2             |
| real shape, momentum flicks              | **fail** jump lost, end lost, anchor lost 11 fr (bottom gap 46), pinned 0, loads 2  | **fail** jump 537, end 309, pinned 1, loads 4 | **fail** jump 5, end 5, pinned 0, loads 3         | **fail** jump 5, end 5, pinned 0, loads 3         | **fail** jump 22, end 22, pinned 0, loads 3       |

Ledger noise floor (-60/-300/flick) (the same input, no page landing, per variant): v0 0/0/1136 px; v1 0/0/0 px; v1s 0/0/0 px; v1s-patched 0/0/0 px; v1+fix 0/0/0 px.

Cell format: jump is the largest residual over the 20 frames after a landing (the worst landing of the run), end the residual at the end of that window, `anchor lost` the frames with the anchor unmounted (then the distance to the bottom of the content stands in for it: it needs no mounted row), `pinned` the landings after which the reader sat at offset 0 with a residual, `loads` the pages requested (one landing each).

What the table shows:

- **`v1` as merged holds in eight of nine cells, to 0.2 to 0.8 px, and fails one: the real shape with momentum flicks** (537 px, pinned at the top of the new page, 4 loads against 3 for the Message Scroller variants). That is the case the owner described. The −60 and −300 wheel cases do not reproduce it in this engine, including the parked-at-0 ones; with wheel steps the landing is held. The earlier quick check's 17,500 px jump and endless loading with −60 steps did not reproduce here.
- **`v1s` and `v1s-patched` fail seven of nine** in this run, with the same numbers: 17 to 59 px with wheel steps, 28 px on the real shape at −300, and 200 to 240 px under momentum on `window=2` from the tail (wheel input dropped in flight, the loss seen in 4.2). They do not get pinned at the top. They do not fail the real flick case by much (5 px).
- **`v0`** loses its anchor in every case (the virtualizer unmounts it), and the distance to the bottom moves by 18 to 891 px, so it keeps the reader's place in neither metric. One landing in the real shape at −300 left the reader pinned at the top.

### 9.3 Why `v1` fails the real-shape flick

The failing landing (`shells/scroll-owner.ts`), from the per-frame trace of a momentum flick on the real shape:

| Frame                         | Anchor offset | scrollTop | Content height |
| ----------------------------- | ------------: | --------: | -------------: |
| last frame before the landing |           423 |        22 |            798 |
| landing frame                 |         1,263 |        22 |          1,638 |
| next frame                    |         1,285 |         0 |          1,638 |

Content grew by 840 px above the reader and `scrollTop` did not move: neither the browser nor the owner adjusted anything, so the reader is shown the top of the new page and the momentum then runs them to 0. Two gates explain it:

1. The owner's one measured restore is taken only when `scrollTop < 1` at the moment the page is about to land. During a momentum flick near the top the main thread reads 22 (a frame or two behind the scrolling thread, which is already at or near 0), so the restore is skipped. It is not skipped because input is active; the code has no such check. It is skipped because the offset it reads is stale.
2. The browser's own anchoring did not hold in that frame either. The likely reason is that WebKit's scrolling thread is at offset 0 while the main thread reads 22 (anchoring is suppressed at offset 0). The data cannot separate that from "anchoring is suspended while a momentum gesture runs"; it only shows that a landing 22 to 106 px from the top under momentum is not held. At the same input but a larger offset (the `window=2` flick from the tail, base offset about 514), the browser does hold it.

An experiment that widened the owner's gate to "within a viewport of the top" (`?fix=2`) hung the harness's web process in two runs, so it has no result.

### 9.4 The prototype fix, and whether it holds

`v1+fix` (`?fix=1`) takes over a landing when the reader is not following: it switches the browser's anchoring off for that landing, remembers where the reader's block sits in the content (not in the viewport), and after layout moves `scrollTop` by how far the block moved. The shift is in content coordinates, so scroll the reader did meanwhile is kept, unlike a restore of a viewport offset. It is about 25 lines, behind the flag, so "v1 as merged" and "v1 fixed" are both in the table.

**It does not hold as prototyped.** It removes the failure it was made for (no pinning, and the real-shape flick lands within 22 px against 537 px), and the parked and −300 cells pass. It passes six of nine, but it fails two cells `v1` passes, `window=2` from the tail with flicks (168 px) and the real shape at −60 (60 px, one wheel step), and the real-shape flick, though 22 px instead of 537, still fails the 2 px line. The trace shows why: a write to `scrollTop` is absolute from the main thread's view, which is behind the scrolling thread's, so the wheel input in flight is dropped (the same loss `v1s` shows). The browser's own anchoring adjusts relative to the scrolling thread and keeps it. So a fix has to leave browser anchoring on wherever it holds and add a correction only for the near-top case, and that correction needs a way to add to the scrolling thread's offset rather than set an absolute one. Not prototyped; the next step for #461 if the owner's case is in scope.

### 9.5 Does the #461 recommendation change?

**No, the path stays `v1`, but the owner is not finished.** Against the patched Message Scroller the picture in this scenario is the same as in 5.1, and a little stronger: `v1` holds eight of nine cells, `v1s-patched` two, and neither is pinned except `v1` in the one real-shape flick case. What changes is the to-do list for #461:

- `v1`'s owner has a real hole at the owner's case: a page landing within about a viewport of the top while a momentum gesture runs. #461 must close it and gate on `S-top-real-flick` (and the other cells) before it ships. The prototype in 9.4 closes the pinning and not the in-flight loss.
- 5.2 gains a rule: the owner cannot rely on browser anchoring near offset 0 under momentum, and cannot correct with an absolute `scrollTop` write either.
- The rig now has the case and the pass line, so it gates that.

### 9.6 What was not tested

- Chromium and Playwright WebKit at full set, three repetitions, and `v2` and `v1+progressive` (scoped out for this pass); one repetition per cell here, so cells near a boundary (the `v1s` 17 px, the 5 px real flick) could flip.
- P1-P4 after the fix: not rerun in this pass; 9.7 reruns them with `v1+near`.
- Safari itself, and a real trackpad: momentum is the harness's synthetic phases.
- Whether anchoring is suppressed at offset 0 or during momentum (9.3), and the near-top gate experiment (`?fix=2`, hung).
- The real compaction marker (the `shape=real` fixture has none), and the daemon's real page latency distribution (60 ms ±30% only).

### 9.7 The near-top correction closes the hole (27 November 2026, #461 step 1)

`v1+near` (`?near=1`, `shells/scroll-owner.ts`) is the fix the 9.4 conclusion asked for. It leaves browser anchoring on, and it adds a correction only when a page lands while the reader is not following and is within a viewport of the top:

1. Before the commit, record the reader's block (the one a third of the way down) in **content** coordinates, not viewport ones, and the `scrollTop` read then.
2. After layout, in the resize callback, measure how far the block moved in the content (`moved`). If `scrollTop` has followed the content by more than half of that, the browser held the reader and nothing is written.
3. Otherwise add the missing shift with `scrollBy({ top: moved, behavior: 'instant' })`.

The two things 9.3 and 9.4 found are both addressed. The gate no longer depends on the main thread reading exactly 0 (a read of 22 or 64 during momentum is inside it). And the write is relative, so the wheel input in flight is kept: the first prototype set an absolute `scrollTop` and lost it, `scrollBy` does not. It is about 20 lines. Content coordinates make the shift independent of the scroll the reader did meanwhile, and the "held" test makes it a no-op wherever the browser already holds, which is why the cells that passed before still pass.

The cause of the browser's miss is still not separated (suppression at offset 0, or suspended anchoring during momentum). The trace is consistent with the first: the failing landing had `scrollTop` 64 one frame before and 22 in the landing frame. The fix does not depend on which it is.

**Result, WKWebView, one pass per cell, load average 9.7 to 10.7 (recorded, not waited out):**

| Case | v1 (9.2) | v1+fix (9.2) | v1+near |
| --- | --- | --- | --- |
| window=2, from the tail, -60 / -300 / flicks | pass / pass / pass | pass / pass / **fail** 168 | pass 0.2 / pass 0.2 / pass 0.2 |
| window=2, parked at 0, -60 / -300 / flicks | pass / pass / pass | pass / pass / pass | pass 0.8 / pass 0.8 / pass 0.8 |
| real shape, -60 px steps | pass | **fail** 60 | pass 0, loads 4 |
| real shape, -300 px steps | pass | pass | pass 0, loads 2 |
| **real shape, momentum flicks** | **fail** 537, pinned | **fail** 22 | **pass 0, end 0, pinned 0, loads 3** |

The ledger's noise floor for `v1+near` is 0/0/0 px. P1 to P5 in the same pass, once each: P1 0.2 px, P1 at offset 0 0.8 px, P2 end 0.2 px against a 0 px control, P3 image 0/0, code 0/0, fold 0.3/0.3, P4 follow gap 0 px with the upward wheel releasing and the jump in 1 frame and the downward wheel still following, P5 at the end on the first visible frame with 0 hidden frames. All pass. The P6 mount row in the summary says "fail" only because it compares against `v0`, which this run did not include; the mount time is 484 ms under the load. Raw results: [`results/s-top-near-wk.json`](../../packages/ui/benchmarks/transcript-list/results/s-top-near-wk.json).

**Repeatability.** Two more passes (three repetitions of the nine S-top cells and of P4, and plain `v1` on two cells for comparison) gave the same table with two exceptions, both a single event in a single repetition:

- `window=2` from the tail at -60 px steps: 60.2 px in 3 of 3 repetitions of the second pass and in 1 of 3 for plain `v1`, with an end residual of 0.2. The trace of a failing landing shows the owner holding the anchor at the landing frame (offset -255.19, the baseline), and then a 60 px step later: the main thread stalled for 60 ms while the page mounted, three wheel events were applied together, and the ledger's prefix model forgave less than the step. That is the ledger's lag error, which plain `v1` shows too, not a landing the owner lost.
- `window=2` from the tail with flicks: 181 and 147 px in one repetition each (the other repetitions 0.2). The trace again shows the anchor held at the landing frame (-191.19 against a baseline of -190) and a single 238 px frame after a 62 ms stall, with a -171 px momentum event in flight. This is the same ledger limit, with a larger event.

So "pass" in the table means the owner held the landing in every run. The two cells above can show a 60 to 240 px ledger artifact under load, and any gate that reads them should repeat the cell and look at the landing frame. The three real-shape cells and the parked cells passed in all four runs.

**What this closes and what it does not.** The owner's case, a real-shape first window with momentum flicks at the top, now holds (0 px against 537 px), and the owner holds every other S-top cell it held before. Not covered: Chromium and Playwright WebKit for the fix (WKWebView only, as the owner's rule says), a real trackpad, and `v1+progressive` with the fix (step 2 re-anchors per slice).

### 9.8 The app's own list in the rig (#461 step 3)

The rig now mounts the code the app ships. The `app` variant (`?v=app`, `shells/AppShell.tsx`) uses the real scroll owner (`features/chat/thread/use-scroll-owner.ts`), the real plain list with its tail-first mount (`PlainMessages`), the real boundary row (`EarlierMessages`, including its loading spinner, which the rig now drives: the older-page loader and P1 and P2 set `historyWindow.loading` while a page is in flight), the real edge fades and the real `TurnTranscript`, in a viewport laid out as the app lays it out. Only the composer is a stub. `v1`'s shell and owner stay as the proof's reference.

**WKWebView, one pass per cell, load average 3.5 to 15.8 (recorded, not waited out):**

| Case | `app` |
| --- | --- |
| P1 / P1 at offset 0 | pass 0.2 px / pass 0.8 px |
| P2 | pass, end 0.2 px, against 0.2 px (control 0 px) |
| P3 | pass, image 0/0, code 0/0, fold 0.3/0.3 |
| P4 | pass, follow gap 0 px; the upward wheel releases; the jump takes 1 frame; the downward wheel keeps following |
| P5 | pass, rows at the tail on the first visible frame, 0 hidden frames, 64 ms to the tail (the one-shot mount took 342 to 553 ms) |
| S-top `window=2`, from the tail, -60 / -300 / flicks | pass 0.2 / pass 0.2 / pass 0.2 (see the note on -300) |
| S-top `window=2`, parked at 0, -60 / -300 / flicks | pass 0.8 / pass 0.8 / pass 0.8 |
| **S-top real shape, -60 / -300 / momentum flicks** | **pass 0 (4 loads) / pass 0 (2 loads) / pass 0, pinned 0 (3 loads)** |

Ledger noise floor: 0/0/0 px. Three more repetitions of S-top gave the real-shape and parked cells the same result every time. **The `window=2` from-the-tail -300 px cell fails the metric in some runs (291.2 px in 2 of 3 repetitions here, and in earlier runs), with the end position correct (0.2 px)**: the ledger counts the wheel late, not the owner losing the reader. The trace of such a run shows the anchor at -15.19 against a baseline of -15 in the landing frame, then one 591 px frame after a 75 ms main-thread stall (the 51-message page, 17,499 px, mounts in that frame while two wheel events queue and are applied together). The -60 cell shows the same single frame less often (60.2 px in 1 of 3 earlier). Plain `v1` shows it too. The stall is the cost of a page that large; #462's bound on the window is what keeps it down. Six repetitions of P4 and P5 ran with no lost web process: jump 1 frame (once 2), a streaming reply with 250 chunks and a frame p95 of 24 to 27 ms.

**Two findings from the review round, both in the first version of this section.**

- **The lost web process was the harness, not the list.** The rig's WKWebView harness reuses one web view and, after `load`, polled until `window.__rig` existed, which the page being left still had; the next call could land on the document being torn down, which fails with "undefined" or "completion handler no longer reachable". Opening pages in a loop without running any scenario failed 11 of 25 times for `app`, 5 of 25 for `v1+near` and 4 of 25 for `v0`. The harness now loads `about:blank` and waits for the old page to go before loading the next; the same loops then failed 0 of 30 for `app` and 0 of 30 for `v0`. `app` hit it more often only because its page loads faster.
- **The scroll-fade mask made a streaming reply run at 4 frames a second.** The first version of the app's viewport kept `scroll-fade-y`, a CSS mask. On a scroller that holds every row (68,000 px with 200 rows), WebKit re-composited the whole content for each change: a streaming reply produced 45 chunks and a frame p95 of 227 ms in 10 s (130 frames in a 10 s P4 run, 36 of them over 150 ms), against 236 chunks and 29 ms for `v1`, which has no mask, and 486 frames with the mask removed. P4 only scored the bottom gap, so it passed. The plain list now draws its fades as two 16 px gradient strips (`TranscriptEdgeFades`): 249 to 254 chunks and 24 to 27 ms, the same as `v1`. Today's list keeps its mask: with a virtualizer the scroller holds a few rows. The rig's P4 table should read `chunks` and `frameP95` next to the gap from now on.

Raw results: [`results/app-wk.json`](../../packages/ui/benchmarks/transcript-list/results/app-wk.json).

**Manual mode** (`?manual=1`) no longer draws the overlay scrollbar thumb by default, as the app's transcript has none (it jumped and resized as pages landed); `scrollbar=1` brings it back.
