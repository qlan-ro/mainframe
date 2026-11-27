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
