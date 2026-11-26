# Opening one long session: benchmark (2026-11-26)

How long Mainframe takes to open one real, long Claude session, stage by stage, measured locally on `main` at deade407 (release daemon, production UI bundle, Chromium through Playwright). The session's transcript was 149 MB, with 46 sub-agent transcripts beside it: 296.68 MB across 47 JSONL files.

| File | What it is |
| --- | --- |
| [REPORT.md](REPORT.md) | The benchmark's full report: totals per case, waterfall, daemon, network and UI stages, every request, reconciliation and limits. |
| [ANALYSIS.md](ANALYSIS.md) | A review of the report against the code, and the changes that would buy the most. |
| [data/waterfall.html](data/waterfall.html) | The waterfall, a self-contained page (open it from disk). |
| `data/daemon.json` | Daemon spans per trial (history, scans, serialisation, HTTP handlers, git). |
| `data/adapter.json`, `data/adapter-initial.json` | The Claude adapter's history stages per file, timed and untimed. |
| `data/snapshot.json`, `data/snapshot_io.json` | The frozen input (file sizes, line counts) and the plain sequential-read control. |
| `data/load-wait.json` | Machine load before and during the runs. |

Not committed: the 14 MB browser event log and the CPU profiles (large, and they carry local file paths), the frozen transcript copy (private), and the harness, which depends on a local diagnostic branch and the frozen copy.

## Headline

| Case | Median to visible content | p95 |
| --- | ---: | ---: |
| Cold daemon and history cache | 1,180 ms | 1,645 ms |
| Warm daemon, UI reload | 319 ms | 431 ms |
| Switch in from a small chat | 184 ms | 250 ms |
| Switch away and back | 142 ms | 152 ms |
| Load one older page | 108 ms | 121 ms |
| Open the largest sub-agent's tab | 664 ms | 716 ms |
