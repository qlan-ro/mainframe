# Analysis of the session-open benchmark

A review of [REPORT.md](REPORT.md) against the code at deade407. Paths are relative to the repository root.

## Where the time goes

| What | Cold | After the first open |
| --- | ---: | ---: |
| Daemon loads the history | 710 ms of 1.18 s | 2–40 ms (cached) |
| Daemon re-reads every file for plan files and skills | 668 ms, after the first paint | not run |
| Browser script and render on a switch | — | 49–88 ms script, about 30 ms React |
| Opening the largest sub-agent's tab | 664 ms, mostly in the browser | same |

The history cache works. After the first open the daemon answers in 2–40 ms, so a switch (142–184 ms) is almost all browser time, and a cold open is mostly the daemon.

## Findings, best value first

1. **The history reader awaits one line at a time through an 8 KB async buffer.** `packages/core-rs/crates/mainframe-adapter-claude/src/history.rs:26–30` uses `tokio::io::BufReader::new(file).lines()`. Waiting for lines takes 328 ms for 296 MB, while reading the same bytes sequentially takes 42 ms. Lines average about 7.7 KB and some are several MB. Reading each file whole off the async runtime, splitting on newlines and parsing from the byte slice should take about 250–280 ms off every cold open. It is a contained change, and it speeds up the second and third passes below too. Estimate; not measured.

2. **Plan-file and skill extraction each read all 47 files again, concurrently** (about 593 MB more), in `packages/core-rs/crates/mainframe-adapter-claude/src/history_paths.rs:23–114`, reached through `session_lifecycle.rs:176` and `:191`. They start after the first paint, so they do not delay it, but for 668 ms they compete for CPU and disk with whatever the user does next. Collecting plan files and used skills during the history read removes both passes: 668 ms less background work, and the loading state ends sooner.

3. **Every sub-agent transcript is parsed before the first view.** The first view shows 23 items of the main conversation, but the adapter also parses the 46 sub-agent files, about half the bytes (`history_subagents.rs`, `history_discovery.rs`). Reading a sub-agent only when its row or tab opens would take roughly another 150–250 ms off a cold open. More work than 1 and 2: the turn grouping uses sub-agent results for its status.

4. **A large sub-agent tab arrives as one 8.76 MB replay message.** The browser spends 131 ms on base64, inflate and UTF-8, 45 ms on schema validation, then renders 585 items. Paging the tab like the main conversation would bring it near a normal switch. UI and daemon work.

5. **Smaller items:**
   - `/api/adapters` is called twice at start-up and takes 76 ms on a warm reload, the slowest start-up request.
   - Every switch runs `git branch`, `git status` and a diff (8–15 ms each, in parallel) even when nothing changed.
   - A switch makes about 53 React commits; batching them would save part of the 30 ms render.

## What does not matter for this session

The suspects from the synthetic gate (`packages/e2e/tests-tauri/windowed-history-performance.spec.ts`) barely show here: overlay-scrollbar hit tests cost 5.6 ms on a warm reload, two message footers were mounted, and there was no long task over 50 ms. The redesign's slower switch on the synthetic conversation (146 → 229 ms on one machine, see the `fix/redesign-perf` work in #964) is real but smaller than the daemon's cold cost for real sessions.

## Limits

- Chromium only. The daemon numbers carry over to the desktop app; WKWebView's browser numbers may differ.
- Instrumentation added about 81 ms to a cold open and 163 ms to a warm reload; the headline table uses the plain runs.
- Some warm runs ran above load 6 and are kept; the cold p95 is one slow run.
- A scratch project and a reduced database stood in for a full workspace, so a full workspace's background work and authenticated GitHub calls are not measured.

## Suggested order

1 and 2 as one daemon change (1 first; both small), then 4. Then 3 and the smaller items.
