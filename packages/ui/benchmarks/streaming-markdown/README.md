# Streaming markdown benchmark

Commit time per streamed chunk for a reply's text part, measured on the production
`TextUnit` with no app, daemon or runtime around it. Run from the repository root
after installing workspace dependencies and Playwright browsers:

```sh
node packages/ui/benchmarks/streaming-markdown/run.mjs
node packages/ui/benchmarks/streaming-markdown/run.mjs --webkit
node packages/ui/benchmarks/streaming-markdown/run.mjs --footnote
node packages/ui/benchmarks/streaming-markdown/run.mjs --webkit --footnote
```

Each invocation starts a temporary Vite server on port 5199 with production React
and the profiling build of `react-dom`, takes three samples (`--samples=N`) and
prints JSON. `--out=<dir>` also writes the raw numbers and light and dark
screenshots of the visual fixture (`VISUAL_REPLY`: every element once). Browser
console errors fail the run.

The reply is synthetic (`content.ts`): 360 lines and 12 KB of headings, prose,
nested lists, task lists, tables, fenced code, quotes and links. `--footnote`
adds one footnote reference near the top and its definition at the end.

- **chunk**: the reply grows by 24 characters per synchronous render
  (`flushSync`), timed from the call to its return. The page runs with reduced
  motion, so the typing reveal shows each prefix whole: one commit costs what one
  reveal frame costs while a reply streams. The first and last quarters show
  whether that cost grows with the length of the reply.
- **live**: 24 characters every 20 ms with the real reveal and real timers.
  Every React commit inside the part is recorded through `<Profiler>`.

## Results, 2026-11-27

Same fixture and machine, three samples each, means of the per-sample values in
milliseconds. "Before" is `origin/main` at `bfc3f2e8` (assistant-ui's
`MarkdownTextPrimitive` and react-markdown); "after" is Streamdown with the
transcript's component map.

| Engine | Reply | Chunk commit, mean | p95 | First quarter | Last quarter | Live: commits, total ms | Live p95 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Chromium | typical | 4.49 → 0.60 | 7.90 → 1.30 | 1.99 → 0.89 | 7.27 → 0.56 | 3,074 → 660 | 6.77 → 1.07 |
| Chromium | footnote | 4.58 → 0.83 | 8.07 → 1.60 | 1.91 → 0.97 | 7.46 → 1.13 | 3,145 → 830 | 6.87 → 1.17 |
| WebKit | typical | 5.07 → 0.75 | 9.00 → 2.00 | 2.84 → 1.25 | 7.77 → 0.53 | 4,326 → 959 | 7.33 → 2.00 |
| WebKit | footnote | 5.14 → 1.08 | 8.67 → 2.00 | 2.83 → 1.34 | 7.66 → 1.32 | 4,182 → 1,212 | 7.00 → 2.00 |

Before, a chunk's commit grew from about 2 ms in the first quarter of the reply to
about 7.5 ms in the last: the whole part was parsed again on every frame. After,
it stays near 1 ms to the end. WebKit's timer reports whole milliseconds.

The live reveal commits about 1,750 to 1,930 times after against 2,250 to 2,470
before, so compare total and per-commit time rather than counts: the two reveals
schedule commits differently, and assistant-ui's also wrote a smooth-status store.
The largest live commit in the footnote case (about 19 ms in Chromium) is the frame
where the definition arrives and the reply becomes one block, so every block
renders once.

## Scope

These are component timings in a browser, not whole-app frame rates or a packaged
Tauri measurement. They cover one text part; the rest of a transcript does not
re-render while a part streams either way.
