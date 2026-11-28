# Raw results

The JSON behind every cell of [the report](../../../../../docs/research/2026-11-26-transcript-list-rig.md). Each file is `{ note, runs, results }`: `runs` lists the parts it joins with the machine's load average (1, 5 and 15 minutes) when each part ended, and `results` has one record per case and repetition, with the `react` build, the boot timings, and the scenario's result (or `ok: false` and its error). The driver scrubs machine paths from the records.

| File | What it is | React build |
| --- | --- | --- |
| `matrix-chromium.json`, `matrix-wk.json`, `matrix-webkit.json` | The main matrix on the rebased branch: `v0`, `v1`, `v1s`, `v1s-patched`, `v2`; tail-first (`v1+progressive`, `v1s-patched+progressive`) with its completion scoring and the cases started while slices land (`E-` and `P6-tail`); `v1s+nopreserve`, `v1s-patched+nopreserve`; `v1+cv` (Chromium and WKWebView only). `wk` also holds a rerun of `v1` cases whose first run lost its web process | profiling |
| `ab-980-chromium.json`, `ab-980-wk.json` | The same-session A/B for #980: `v0@pre980` (source at 2ff3560b) against `v0@post980` (source at 33a906d5), `v1` as control, rounds alternating | plain `react-dom` |
| `chromium-p4-release-repeat.json` | Six repetitions of the upward-wheel release case for `v1s-patched`, `v1s` and `v1`, to measure how often the release holds | profiling |
| `s-top-wk.json`                                                | S-top and S-noise (report section 9): `v0`, `v1`, `v1+fix`, `v1s`, `v1s-patched` in WKWebView, one repetition per case, load average 6.2                                                                                                                                                                                                                                                        | profiling         |

`E-` cases for plain `v1` appear in the `wk` and `chromium` matrices from an earlier plan of the run: they start a scenario before the owner has settled and race its own mount, so the report does not use them. Cases listed in `summarize.mjs`'s `Errors` line are harness failures (the WKWebView process died); a cell is blank when every repetition failed.

Summarize with `node ../driver/summarize.mjs matrix-chromium.json` (add `ab-980-*.json` for the A/B).
| `s-top-near-wk.json` | The near-top correction (`v1+near`, report section 9.7): one pass of P1 to P5, S-top and S-noise, then three repetitions of S-top and P4, with plain `v1` on two cells for comparison. WKWebView, load average 9.7 to 10.7 | profiling |
| `app-wk.json` | The app's own list (`?v=app`, report section 9.8): one pass of P1 to P5, S-top and S-noise, then three repetitions of S-top and P4. WKWebView, load average 2.6 to 15.8 | profiling |
| `agent-wk.json` | The sub-agent cases (#463): A-park, A-wheel and A-bound on `agent`, `agent+plain=0`, `agent+inline` and `agent+inline+plain=0`, plus `agent@unbounded` (A-bound with the page window lifted, for comparison). WKWebView, one pass, load average (1 min) 3.9 and 6.7 at the end of each part | profiling |
| `scroll-fixes-wk.json` | The plain list's scroll fixes (#521, #519, #517): R-read, R-send, R-switch, S-top-heavy and B-short on `app@main` (main at acf84635) and `app@fix`, and one pass of P1 to P5 and S-top on the fix. WKWebView, load average (1 min) 9 to 18 | plain `react-dom` |
| `queued-send-wk.json` | A send that queues behind a running turn (#519, report section 9.9): R-send-queued on `app@main` (main at 874cdfd0) and `v0@main`, and on `app@fix` with one pass of R-send, R-read, B-short and P1 to P5; `app@fix2` (the final branch) has R-send-queued again and R-type with and without the footer observer, two repetitions. WKWebView, load average (1 min) 2.9 and 4.6 | profiling |
