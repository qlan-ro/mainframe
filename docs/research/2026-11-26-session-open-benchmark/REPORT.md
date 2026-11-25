# Opening one long session: benchmark

Chromium, release daemon and production bundle at deade407. Times are milliseconds. Each group shows median / p95 / min / max. Cold starts include UI navigation after the isolated daemon has bound its port.

| Case | Trials / successful | First visible message + two animation frames | Verified composer edit | One-minute load |
|---|---:|---:|---:|---:|
| cold | 5 / 5 | 1,179.5 / 1,645.0 / 1,160.9 / 1,645.0 | 1,234.3 / 1,706.2 / 1,216.2 / 1,706.2 | 4.6 / 5.0 / 4.1 / 5.0 |
| reload | 10 / 10 | 319.3 / 430.9 / 283.7 / 430.9 | 376.2 / 499.5 / 340.8 / 499.5 | 6.4 / 6.7 / 5.0 / 6.7 |
| first-switch | 10 / 10 | 183.6 / 249.5 / 183.1 / 249.5 | 227.5 / 293.9 / 226.7 / 293.9 | 5.8 / 5.9 / 5.6 / 5.9 |
| back | 10 / 10 | 141.7 / 151.6 / 133.7 / 151.6 | 185.9 / 194.4 / 173.4 / 194.4 | 6.3 / 6.7 / 6.1 / 6.7 |
| page | 10 / 10 | 108.1 / 120.5 / 101.1 / 120.5 | — | 6.4 / 6.7 / 6.1 / 6.7 |
| subagent | 5 / 5 | 663.6 / 715.9 / 632.0 / 715.9 | — | 5.5 / 5.9 / 5.2 / 5.9 |
| switch | 10 / 10 | 149.7 / 151.3 / 133.7 / 151.3 | 191.3 / 194.8 / 175.2 / 194.8 | 6.4 / 6.7 / 6.1 / 6.7 |

First-switch starts in the small chat in a fresh browser context. Back and the supplementary switch sample both revisit the target in the same context. The page case ends when the loaded count grows and two animation frames pass. The sub-agent case runs the product tab-opening action and waits for its brief. The largest child with a mapped parent tool call was selected. The browser records a separate 500 ms observation period after each action. The diagnostic pass below also measures browser quiet. Whole-process quiescence was not established.

## Where the time went

The first cold view took **1.18 s**. The initial history restore occupied **710 ms** in five instrumented cold runs. The front end displayed 23 history items and mounted two message elements at the first-view marker. To produce that view on a cache miss, the adapter processed **296.68 MB** across the primary transcript and 46 sub-agent JSONLs. Two further scans for plan files and used skills read those same sources concurrently. Together the three passes account for about **890 MB of logical JSONL input**. macOS served cached pages, so physical storage traffic can be much smaller.

| Rank | Cost | Share and overlap | What reducing it could buy |
|---|---|---|---|
| 1 | Cold canonical history restore, 710 ms median, including 684 ms in the adapter | 56% of the 1,261 ms instrumented cold median. The REST resume waited for it before ACP replay. | A validated tail available before canonical restore could move some of this interval behind first paint. **710 ms is an upper bound** on this trace. On the standalone reader, the main file took 278 ms and all 46 child files took 265 ms. See `mainframe-chat/src/lifecycle_manager/history.rs:9`, `mainframe-adapter-claude/src/history.rs:88` and `mainframe-server/src/routes/chat_commands.rs:137`. |
| 2 | Plan-file and used-skill extraction, 668 ms elapsed | Each of the two readers visited 47 files. They overlapped each other and the visible view. Their combined interval began about 997 ms after navigation. | Collecting the metadata during a necessary pass could avoid up to 593 MB of repeat input and shorten the background tail. A first-paint saving was not measured. See `mainframe-adapter-claude/src/history_paths.rs:40` and `mainframe-server/src/chat_deps/scan.rs:139`. |
| 3 | Opening the 24.98 MB child used 361 ms of browser script | About 54% of its 664 ms median, with the script counter extending through the observation period. Fetching the call expanded the parent window from 23 to 585 items. A single response carried 8,762,470 bytes. | Targeted retrieval could reduce the historical window decoded for one call. In one native trace, base64/inflate/UTF-8 took 131 ms, validation 45 ms, replay JSON parsing 15 ms, and React rendering about 73 ms. These are measured costs. Savings depend on how much data could be omitted. See `packages/ui/src/features/workspace-chat/SubagentTabBody.tsx:78` and `packages/ui/src/lib/daemon/acp-replay-batch.ts:35`. |
| 4 | Cold navigation to daemon history start, 227 ms median | About 18% of the instrumented cold median. This includes app bootstrap, initial requests, mounting the sidebar, Playwright locating and clicking the chat, and the request reaching the daemon. | This is an **unattributed interval**. It cannot all be charged to React or removed by a daemon change. Cold HTTP traffic through first view was 4.47 MB versus 23 KB on warm reload. The UI entry point is `packages/ui/src/app/main.tsx:30` on deade407. |
| 5 | Cold ACP resume preparation, 113 ms median | About 9% of the instrumented cold median. Its start was around 955 ms. It overlaps background snapshot serialization and the start of metadata extraction. | The measured ceiling for reducing this preparation is 113 ms. Its nested grouping, state cloning and history windowing were not isolated individually. Cold replay deflate itself took about 2 ms. See `mainframe-server/src/acp_ws/dispatch/resume_prepare.rs:17` and `mainframe-acp/src/replay_batch.rs:59`. |

Rust file references above are relative to `packages/core-rs/crates/`. Percentages refer to the named case. They cannot be summed across cases or concurrent spans.

The initial ACP batch contained **81 updates**, **342,601 bytes** of serialized JSON and **138,324 bytes** after deflation. With base64 and the envelope it occupied **184,584 bytes**, around **0.062%** of the 296.68 MB raw history. This is the measured wire requirement for the observed view. It does not establish the smallest set of source lines that would reproduce it. The standalone adapter returned 7,296 canonical messages, or about **0.077 ms per message** and **1.90 ms per decimal MB**. Across the 47 files, waiting for the next buffered line took 328 ms, JSON parsing took 133 ms, and per-record conversion took 56 ms. The two mounted message elements belong to a different representation from canonical messages and ACP updates.

On the named-build warm reload, all calls to `elementsFromPoint` together cost 5.6 ms and `getBoundingClientRect` cost 0.6 ms. The mounted React tree included two MessageFooter components, five context-menu triggers and 37 tooltip triggers across the application. These are counts after the action. They do not attribute render time to those components. Activity-model parsing did not receive a separate timer. This session gives stronger evidence for working on history restoration, repeat scans and large child payloads than on scrollbar hit testing.

## Fixture, resource coverage and limits

The machine was a 12-core Apple M3 Pro with 36 GiB RAM, macOS 27.0.1 and Playwright 1.65.1. The release source was `deade407943cda0d54a35dea341f214c8c92823f`. Each cold trial restarted the private daemon, cleared its history caches and created a fresh browser. macOS file caches were warm. The browser navigated after the daemon bound its port. Daemon process launch, Chromium process launch and native window creation are outside the reported total.

The benchmark waited until the one-minute load average reached 5.91. Other work continued on the Mac. The final cold trials started at loads 4.1–5.0. Some warm trials exceeded 6. Every run retains its starting load. The small sample p95 is the nearest rank and equals the maximum for 5 and 10 trials.

The private fixture retained the target chat, its native-session and segment records, a scratch Git project and an empty comparison chat. Unrelated projects, settings, tags and delegated-task records were removed from the working database. This makes the timings for the session history representative of this frozen session. Catalogue, Git, task, thread-list and watcher costs in the owner's populated workspace may differ. The comparison chat had no history. The last visible mounted element intersected the viewport in every baseline first-view check. Paint uses a visibility check and two animation frames. Physical display presentation and first readable pixels were not independently timestamped.

| Resource | Evidence and limits |
|---|---|
| Skills catalogue, agent catalogue, commands, adapter models and CLI status | HTTP requests and per-route timings appear in the HTTP inventory and concurrent-stage tables. The isolated HOME held only the frozen Claude session. The owner's installed catalogues were unavailable. Used skills and plan files had independent 47-file scans. |
| Git branch, status, working changes and worktrees | Cold tracing observed git branch, status, diff and worktree calls. Their handler and subprocess intervals are in the concurrent-stage table. The scratch repo was empty. |
| PR detection, mentions and credentials | PR URL scanning took about 34 ms on cold history. The scanner extracts URLs locally, persists discoveries in SQLite and emits events. A GitHub token does not change this scanner. Separate GitHub API features use credentials for requests such as listing issues or retrieving PR metadata when invoked. The sandbox excluded gh, provider CLIs and outbound TCP. Authenticated API latency and external gh behavior were not measured. See `packages/core-rs/crates/mainframe-server/src/chat_deps/scan.rs` and `packages/core-rs/crates/mainframe-github/src/issues.rs`. |
| Background tasks, workflow runs, project list, thread list, tags, quotas, automation interactions and tunnels | Requests observed in the browser are listed with counts, encoded sizes and timings. The local tunnel list handler ran with tunneling disabled. Claude and Codex quota endpoints had no owner credentials. |
| Attachments, images and tool results | The fixture contains 104 tool-result files totaling 16,105,179 bytes. No separate attachment body request was identified in the native cold first view. Embedded data and local file access cannot be inferred from that observation. |
| Session context, memory files, delegated children, scheduled jobs, Activity, launch configs, language servers and watchers | No independent timing can be assigned to these from the available traces. Empty or unmounted UI and removed database records can suppress work. A missing network request does not prove zero daemon work. Generic chat subscribe and its acknowledgment were observed alongside ACP initialize/resume. |
| Database, files and subprocesses | SQLite helper queries, Git subprocesses, each canonical JSONL reader and both secondary scans were instrumented. macOS rejected unprivileged fs_usage. An exhaustive kernel-level list of opens, reads, descendants and watcher events is unavailable. The database helpers also omit direct SQL elsewhere. |
| Browser and daemon completion | HTTP timing includes browser-provided queue/connection phases where Chromium supplied them. WS frame timing records endpoint observation, not a NIC timestamp separating queue time from transfer time. CDP traces and CPU samples, React commits, replay decoding, message-unit construction and layout/paint counters cover different overlapping intervals. Whole-daemon completion, reducer-by-reducer attribution and separate skill-file filesystem latency remain unknown. |
| WebKit | Only Chromium was measured. No matching Playwright WebKit binary was installed. The owner's Tauri app and its WKWebView storage were untouched. |
| Sub-agent tab | The runner invoked the same tab-opening function as the row action and waited for the child's brief. Finding and scrolling to the parent tool row is outside the child-tab time. |

The frozen files were APFS clones taken file by file, with SHA-256 and newline counts recorded. All 197 hashes matched again after the runs. The set occupies 312,795,790 logical bytes. This is a stable input for every trial, with no claim that copying the files formed a single atomic transaction across the live directory.

Earlier exploratory runs used Playwright WebSocket forwarding. The native-path control reduced the child-tab median from 1,014 ms to 664 ms. Only native-path trials feed the headline table. A preliminary forwarding pilot overlapped compilation. During the change of harness, 21 exploratory browser invocations exited with a missing import before recording an action and a port-preflight attempt hit TIME_WAIT. Both were corrected and the complete native series was rerun. All recorded actions, including pilots, are retained under data/. The release and diagnostic changes stayed local.

## Reconciled timeline

The representative trial is the successful trial closest to the median. Every interval below is relative to the harness action start. The last column covers the part of the observation interval after the edit or paint, including the deliberate wait. Browser launch and daemon boot precede this clock.

| Case | First content or page paint | Composer acceptance | Remaining observation | Total observation | Mounted / loaded | Tail element intersected viewport |
|---|---:|---:|---:|---:|---:|---|
| cold | 0–1179.5 | 1179.5–1234.9 | 1234.9–1740.9 | 1740.9 | 2 / 23 | True |
| reload | 0–318.5 | 318.5–367.2 | 367.2–872.7 | 872.7 | 2 / 23 | True |
| first-switch | 0–183.6 | 183.6–227.0 | 227.0–731.5 | 731.5 | 2 / 23 | True |
| back | 0–149.4 | 149.4–192.6 | 192.6–697.8 | 697.8 | 2 / 23 | True |
| page | 0–112.7 | — | 112.7–615.1 | 615.1 | 3 / 34 | True |
| subagent | 0–663.6 | — | 663.6–1168.4 | 1168.4 | 2 / 585 | True |
| switch | 0–149.8 | 149.8–191.1 | 191.1–695.5 | 695.5 | 2 / 23 | True |

## Browser work

Chromium performance-counter differences between action start and end of observation. Reload changed the document and reset counters, so its deltas are omitted. The React and trace tables cover reload. Script, style and layout can overlap other work and span user-visible completion.

| Case | Script ms | Style ms | Layout ms | HTTP calls | WS received bytes |
|---|---:|---:|---:|---:|---:|
| cold | 261.5 / 277.0 / 259.6 / 277.0 | 31.2 / 31.7 / 30.4 / 31.7 | 23.3 / 28.5 / 22.8 / 28.5 | 53.0 / 54.0 / 53.0 / 54.0 | 195,537.0 / 195,537.0 / 195,537.0 / 195,537.0 |
| reload | — | — | — | 53.0 / 53.0 / 53.0 / 53.0 | 195,537.0 / 195,537.0 / 195,537.0 / 195,537.0 |
| first-switch | 88.1 / 96.3 / 83.6 / 96.3 | 12.5 / 14.3 / 11.9 / 14.3 | 7.8 / 9.4 / 7.5 / 9.4 | 7.0 / 8.0 / 7.0 / 8.0 | 192,004.0 / 192,004.0 / 192,004.0 / 192,004.0 |
| back | 48.7 / 53.9 / 44.5 / 53.9 | 11.3 / 13.0 / 10.2 / 13.0 | 3.9 / 4.2 / 3.5 / 4.2 | 8.0 / 8.0 / 8.0 / 8.0 | 7,650.0 / 7,650.0 / 7,650.0 / 7,650.0 |
| page | 33.3 / 37.5 / 29.9 / 37.5 | 8.4 / 9.8 / 7.3 / 9.8 | 3.0 / 3.8 / 2.8 / 3.8 | 0.0 / 0.0 / 0.0 / 0.0 | 84,541.0 / 84,541.0 / 84,541.0 / 84,541.0 |
| subagent | 361.2 / 377.6 / 354.4 / 377.6 | 27.2 / 28.7 / 25.7 / 28.7 | 24.4 / 27.1 / 23.4 / 27.1 | 6.0 / 6.0 / 6.0 / 6.0 | 8,762,470.0 / 8,762,470.0 / 8,762,470.0 / 8,762,470.0 |
| switch | 49.8 / 55.8 / 48.3 / 55.8 | 12.4 / 13.4 / 11.1 / 13.4 | 3.8 / 4.1 / 3.5 / 4.1 | 7.0 / 8.0 / 7.0 / 8.0 | 7,650.0 / 7,650.0 / 7,650.0 / 7,650.0 |

## HTTP and WebSocket inventory

Counts cover all captured trials including the post-action observation. TTFB uses the browser response timing, when available. Transfer uses response headers to loadingFinished. CDP encoded bytes include transport overhead as reported by Chromium. Browser callbacks alone cannot establish whether any one request blocks the first view.

| Request or frame | Count | TTFB ms | Transfer ms | Total bytes |
|---|---:|---:|---:|---:|
| GET /:id | 74 | 0.9 / 5.0 / 0.6 / 6.0 | -0.2 / -0.1 / -4.7 / -0.1 | 168,128 |
| GET /api/adapters | 148 | 74.8 / 142.2 / 7.7 / 181.7 | -5.5 / -0.1 / -41.7 / 0.0 | 143,778 |
| GET /api/adapters/claude/agents | 76 | 0.5 / 17.3 / 0.2 / 26.6 | -1.3 / -0.0 / -9.5 / 0.1 | 26,524 |
| GET /api/adapters/claude/effective-model | 268 | 0.6 / 19.6 / 0.3 / 43.7 | -1.8 / -0.1 / -60.6 / 0.2 | 94,068 |
| GET /api/adapters/claude/skills | 76 | 0.7 / 17.5 / 0.4 / 26.6 | -1.4 / 0.0 / -9.6 / 0.1 | 26,524 |
| GET /api/automation-interactions | 74 | 0.8 / 14.5 / 0.2 / 16.0 | -9.6 / -1.1 / -40.7 / -0.3 | 25,826 |
| GET /api/chats | 412 | 1.1 / 18.1 / 0.7 / 34.0 | -1.2 / -0.1 / -64.0 / 0.0 | 500,580 |
| GET /api/chats/:id | 74 | 9.5 / 35.2 / 0.6 / 37.6 | -14.6 / -0.2 / -37.9 / 0.0 | 86,580 |
| GET /api/chats/:id/background-tasks | 205 | 0.5 / 15.6 / 0.2 / 29.1 | -4.2 / -0.1 / -59.8 / 0.0 | 73,595 |
| GET /api/chats/:id/workflow-runs | 74 | 5.9 / 33.9 / 0.6 / 46.6 | -6.6 / -0.1 / -37.9 / -0.0 | 25,826 |
| GET /api/chats/bench-small/background-tasks | 2 | 0.4 / 0.5 / 0.4 / 0.5 | -2.5 / -1.9 / -3.1 / -1.9 | 718 |
| GET /api/chats/bench-small/workflow-runs | 2 | 0.8 / 0.9 / 0.7 / 0.9 | -2.3 / -2.1 / -2.6 / -2.1 | 698 |
| GET /api/commands | 74 | 9.7 / 19.8 / 0.6 / 21.7 | -4.5 / -0.5 / -21.9 / -0.0 | 245,902 |
| GET /api/projects | 254 | 1.5 / 28.4 / 0.3 / 43.1 | -5.6 / -0.2 / -168.5 / 0.2 | 157,226 |
| GET /api/projects/:id/git/branch | 192 | 13.3 / 47.2 / 8.2 / 116.5 | -2.4 / -0.0 / -61.0 / 0.3 | 69,504 |
| GET /api/projects/:id/git/status | 192 | 14.1 / 50.5 / 8.1 / 112.3 | -2.3 / -0.0 / -62.8 / 0.3 | 74,880 |
| GET /api/projects/:id/git/working-stat | 192 | 14.6 / 59.6 / 6.9 / 124.6 | -2.3 / -0.0 / -63.9 / 0.2 | 141,504 |
| GET /api/projects/:id/launch/configs | 15 | 0.9 / 1.9 / 0.7 / 1.9 | -2.7 / -1.2 / -10.8 / -1.2 | 5,235 |
| GET /api/projects/:id/launch/status | 15 | 1.2 / 1.3 / 0.6 / 1.3 | -2.6 / -1.0 / -10.8 / -1.0 | 7,575 |
| GET /api/projects/:id/tree | 15 | 1.7 / 7.0 / 0.6 / 7.0 | -3.8 / -0.2 / -15.1 / -0.2 | 5,235 |
| GET /api/providers/claude/quota | 148 | 1.8 / 17.3 / 0.1 / 50.4 | -7.8 / -0.7 / -36.2 / -0.2 | 50,172 |
| GET /api/providers/cli-status | 148 | 2.7 / 19.1 / 0.1 / 32.5 | -7.8 / -0.7 / -48.3 / -0.2 | 51,652 |
| GET /api/providers/codex/quota | 148 | 2.8 / 18.4 / 0.2 / 21.1 | -7.4 / -0.4 / -48.5 / -0.3 | 50,172 |
| GET /api/settings/providers | 74 | 11.8 / 29.6 / 0.6 / 43.5 | -8.2 / -0.1 / -34.5 / 0.0 | 39,442 |
| GET /api/tags | 148 | 0.7 / 15.4 / 0.2 / 17.1 | -9.9 / -0.4 / -46.1 / -0.2 | 51,652 |
| GET /api/tunnel/ports | 148 | 5.8 / 30.4 / 0.2 / 41.5 | -8.2 / -0.5 / -48.5 / -0.2 | 56,240 |
| GET /assets/:id | 1406 | 9.0 / 20.9 / 1.1 / 30.0 | -0.2 / 0.6 / -25.1 / 6.7 | 241,025,181 |
| GET /health | 170 | 0.5 / 2.1 / 0.3 / 23.0 | -0.2 / -0.1 / -13.0 / -0.0 | 71,701 |
| OPTIONS /api/session-transcripts/resolve | 2 | — | -0.0 / -0.0 / -0.0 / -0.0 | 0 |
| POST /api/chats/:id/resume | 199 | 10.2 / 740.0 / 1.0 / 811.1 | -15.1 / -0.1 / -34.6 / -0.0 | 67,461 |
| POST /api/session-transcripts/resolve | 2 | 1.2 / 1.4 / 1.0 / 1.4 | -3.1 / -1.6 / -4.6 / -1.6 | 1,330 |
| ws-in (response / other) | 1175 | — | — | 137,067,169 |
| ws-in _mainframe.dev/queue_state | 192 | — | — | 21,484 |
| ws-in _mainframe.dev/replay_batch | 192 | — | — | 16,820,455 |
| ws-in _mainframe.dev/replay_complete | 192 | — | — | 20,332 |
| ws-in subscribe:ack | 95 | — | — | 5,415 |
| ws-out (response / other) | 164 | — | — | 8,232 |
| ws-out _mainframe.dev/history_page | 62 | — | — | 12,113 |
| ws-out _mainframe.dev/session_detach | 118 | — | — | 11,230 |
| ws-out initialize | 74 | — | — | 20,350 |
| ws-out session/resume | 192 | — | — | 49,252 |
| ws-out subscribe | 95 | — | — | 5,035 |
| ws-out unsubscribe | 58 | — | — | 2,610 |

## Wire timing on the representative trial

Offsets are milliseconds from action start to the CDP callback. Events can occur during rendering. The final gap includes decoding, UI work, automation and frame scheduling.

| Case | Request session/resume | First replay batch | Replay complete | View marker |
|---|---:|---:|---:|---:|
| cold | 915.8 | 1059.8 | 1062.2 | 1179.5 |
| reload | 157.0 | 225.4 | 226.9 | 318.5 |
| first-switch | 61.7 | 76.2 | 78.6 | 183.6 |
| back | 65.1 | 68.4 | 68.8 | 149.4 |
| page | — | — | — | 112.7 |
| subagent | — | — | — | 663.6 |
| switch | 65.0 | 69.5 | 69.7 | 149.8 |

## Release adapter on the frozen files

The isolated adapter produced 7,296 history messages from 47 JSONL files. It processed the primary transcript and each child sequentially. Per-file timestamps use a single origin just after discovery. The standalone entry point performs the directory scan without a populated source index. Its durations are independent measurements and overlap the daemon history interval in the product.

| Stage | ms, median / p95 / min / max | Median share of adapter time |
|---|---:|---:|
| Opening files | 3.8 / 5.5 / 3.1 / 5.5 | 0.7% |
| Awaiting next JSONL line¹ | 327.8 / 415.6 / 323.7 / 415.6 | 58.7% |
| serde_json parse | 133.3 / 139.8 / 129.8 / 139.8 | 23.5% |
| History conversion and grouping per record | 56.1 / 61.5 / 53.9 / 61.5 | 9.9% |
| Final grouping and child merge | 15.1 / 21.0 / 12.9 / 21.0 | 2.6% |
| File loop remainder including value destruction | 24.2 / 24.8 / 23.6 / 24.8 | 4.3% |
| Discovery, timing and remaining gaps | 2.0 / 2.3 / 1.9 / 2.3 | 0.4% |

¹ Includes asynchronous reads, line splitting, buffered-line delivery and scheduler time. Physical disk latency was not isolated.

Baseline adapter total in ms: 563.2 / 677.0 / 534.9 / 677.0.

Timed adapter total in ms: 561.5 / 664.9 / 552.8 / 664.9.

Paired increase from per-record timers and per-file counters, in ms: 0.1 / 130.0 / -115.1 / 130.0. Baseline processes used the same diagnostic binary with the flag unset.

Sequential read_bytes control on the same 296,677,465 bytes, in ms: 41.9 / 46.6 / 39.4 / 46.6. macOS file caches were warm.

| File index | Lines | Bytes excluding newlines | Elapsed ms | Open ms | Next line ms | Parse ms | Convert ms |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 19434 | 149315185 | 278.3 / 288.2 / 272.4 / 288.2 | 0.0 / 0.0 / 0.0 / 0.0 | 165.0 / 175.1 / 161.5 / 175.1 | 71.4 / 75.3 / 69.7 / 75.3 | 25.8 / 27.8 / 24.6 / 27.8 |
| 1 | 233 | 2261802 | 4.7 / 5.0 / 3.9 / 5.0 | 0.1 / 0.2 / 0.1 / 0.2 | 2.5 / 2.7 / 2.0 / 2.7 | 1.3 / 1.4 / 1.1 / 1.4 | 0.5 / 0.6 / 0.4 / 0.6 |
| 2 | 99 | 834089 | 2.1 / 2.1 / 1.8 / 2.1 | 0.1 / 0.1 / 0.1 / 0.1 | 0.9 / 1.0 / 0.8 / 1.0 | 0.7 / 0.8 / 0.6 / 0.8 | 0.2 / 0.2 / 0.1 / 0.2 |
| 3 | 122 | 944595 | 2.3 / 2.6 / 2.1 / 2.6 | 0.1 / 0.1 / 0.0 / 0.1 | 1.1 / 1.2 / 0.9 / 1.2 | 0.8 / 0.8 / 0.7 / 0.8 | 0.3 / 0.3 / 0.2 / 0.3 |
| 4 | 200 | 1576569 | 4.1 / 4.2 / 3.5 / 4.2 | 0.1 / 0.1 / 0.0 / 0.1 | 1.8 / 1.9 / 1.5 / 1.9 | 1.4 / 1.4 / 1.2 / 1.4 | 0.6 / 0.7 / 0.5 / 0.7 |
| 5 | 309 | 2904145 | 7.5 / 8.6 / 6.7 / 8.6 | 0.1 / 0.2 / 0.0 / 0.2 | 3.3 / 4.3 / 2.8 / 4.3 | 2.1 / 2.2 / 1.9 / 2.2 | 1.6 / 1.8 / 1.5 / 1.8 |
| 6 | 196 | 24983453 | 31.2 / 43.6 / 28.6 / 43.6 | 0.1 / 0.2 / 0.1 / 0.2 | 26.7 / 37.3 / 23.9 / 37.3 | 3.3 / 4.4 / 3.1 / 4.4 | 1.1 / 1.5 / 1.0 / 1.5 |
| 7 | 338 | 2779783 | 7.9 / 8.8 / 6.9 / 8.8 | 0.1 / 0.2 / 0.1 / 0.2 | 3.2 / 3.9 / 2.7 / 3.9 | 2.7 / 2.7 / 2.4 / 2.7 | 1.5 / 1.7 / 1.4 / 1.7 |
| 8 | 98 | 778185 | 2.0 / 3.6 / 1.7 / 3.6 | 0.1 / 0.3 / 0.1 / 0.3 | 0.9 / 1.9 / 0.7 / 1.9 | 0.7 / 1.1 / 0.6 / 1.1 | 0.2 / 0.3 / 0.1 / 0.3 |
| 9 | 232 | 2192302 | 5.4 / 5.7 / 4.8 / 5.7 | 0.1 / 0.1 / 0.0 / 0.1 | 2.5 / 2.7 / 2.2 / 2.7 | 1.7 / 1.7 / 1.5 / 1.7 | 0.9 / 1.0 / 0.8 / 1.0 |
| 10 | 160 | 9266715 | 12.6 / 13.6 / 11.2 / 13.6 | 0.1 / 0.1 / 0.1 / 0.1 | 10.0 / 10.7 / 8.7 / 10.7 | 1.7 / 1.9 / 1.6 / 1.9 | 0.7 / 0.8 / 0.6 / 0.8 |
| 11 | 149 | 1329931 | 3.1 / 3.3 / 2.6 / 3.3 | 0.1 / 0.2 / 0.1 / 0.2 | 1.5 / 1.6 / 1.2 / 1.6 | 0.9 / 1.0 / 0.8 / 1.0 | 0.4 / 0.5 / 0.4 / 0.5 |
| 12 | 450 | 3331030 | 10.3 / 12.1 / 9.9 / 12.1 | 0.1 / 0.1 / 0.1 / 0.1 | 3.9 / 5.1 / 3.7 / 5.1 | 3.1 / 3.3 / 2.9 / 3.3 | 2.7 / 3.2 / 2.6 / 3.2 |
| 13 | 201 | 1656150 | 4.3 / 4.4 / 3.7 / 4.4 | 0.1 / 0.1 / 0.1 / 0.1 | 1.9 / 1.9 / 1.6 / 1.9 | 1.5 / 1.5 / 1.3 / 1.5 | 0.6 / 0.6 / 0.5 / 0.6 |
| 14 | 205 | 1414541 | 4.0 / 4.6 / 3.8 / 4.6 | 0.1 / 0.1 / 0.0 / 0.1 | 1.6 / 2.1 / 1.6 / 2.1 | 1.4 / 1.5 / 1.3 / 1.5 | 0.6 / 0.7 / 0.6 / 0.7 |
| 15 | 174 | 1101903 | 3.1 / 3.5 / 2.7 / 3.5 | 0.1 / 0.1 / 0.1 / 0.1 | 1.2 / 1.5 / 1.0 / 1.5 | 1.1 / 1.2 / 1.0 / 1.2 | 0.5 / 0.6 / 0.4 / 0.6 |
| 16 | 357 | 1435702 | 6.0 / 6.2 / 5.3 / 6.2 | 0.1 / 0.1 / 0.1 / 0.1 | 1.7 / 1.8 / 1.4 / 1.8 | 1.9 / 1.9 / 1.7 / 1.9 | 1.9 / 2.0 / 1.7 / 2.0 |
| 17 | 26 | 95854 | 0.4 / 0.4 / 0.3 / 0.4 | 0.1 / 0.1 / 0.1 / 0.1 | 0.1 / 0.2 / 0.1 / 0.2 | 0.1 / 0.1 / 0.1 / 0.1 | 0.0 / 0.0 / 0.0 / 0.0 |
| 18 | 114 | 1125728 | 2.4 / 3.5 / 2.1 / 3.5 | 0.0 / 0.1 / 0.0 / 0.1 | 1.2 / 2.3 / 1.1 / 2.3 | 0.7 / 0.7 / 0.7 / 0.7 | 0.3 / 0.4 / 0.3 / 0.4 |
| 19 | 211 | 1366825 | 3.7 / 3.9 / 3.2 / 3.9 | 0.1 / 0.1 / 0.0 / 0.1 | 1.6 / 1.7 / 1.3 / 1.7 | 1.3 / 1.3 / 1.1 / 1.3 | 0.6 / 0.6 / 0.5 / 0.6 |
| 20 | 76 | 2315499 | 3.4 / 3.8 / 3.0 / 3.8 | 0.1 / 0.1 / 0.1 / 0.1 | 2.6 / 2.9 / 2.1 / 2.9 | 0.6 / 0.6 / 0.5 / 0.6 | 0.1 / 0.2 / 0.1 / 0.2 |
| 21 | 181 | 1600594 | 4.0 / 4.3 / 3.5 / 4.3 | 0.1 / 0.1 / 0.0 / 0.1 | 1.8 / 2.0 / 1.5 / 2.0 | 1.4 / 1.4 / 1.3 / 1.4 | 0.5 / 0.6 / 0.5 / 0.6 |
| 22 | 301 | 13511867 | 19.9 / 23.0 / 18.4 / 23.0 | 0.1 / 0.1 / 0.0 / 0.1 | 14.7 / 17.4 / 13.3 / 17.4 | 3.0 / 3.2 / 2.9 / 3.2 | 1.8 / 2.0 / 1.8 / 2.0 |
| 23 | 112 | 866859 | 2.2 / 3.0 / 1.9 / 3.0 | 0.1 / 0.2 / 0.1 / 0.2 | 1.0 / 1.6 / 0.8 / 1.6 | 0.8 / 0.9 / 0.7 / 0.9 | 0.2 / 0.2 / 0.2 / 0.2 |
| 24 | 203 | 18339595 | 24.2 / 36.0 / 22.1 / 36.0 | 0.1 / 0.1 / 0.0 / 0.1 | 20.1 / 31.1 / 18.0 / 31.1 | 2.8 / 3.2 / 2.8 / 3.2 | 1.0 / 1.3 / 0.9 / 1.3 |
| 25 | 62 | 1232147 | 2.0 / 2.9 / 1.8 / 2.9 | 0.1 / 0.2 / 0.1 / 0.2 | 1.3 / 1.9 / 1.1 / 1.9 | 0.4 / 0.6 / 0.4 / 0.6 | 0.1 / 0.2 / 0.1 / 0.2 |
| 26 | 152 | 1179992 | 3.1 / 4.0 / 2.6 / 4.0 | 0.1 / 0.1 / 0.0 / 0.1 | 1.4 / 1.9 / 1.1 / 1.9 | 1.1 / 1.4 / 1.0 / 1.4 | 0.4 / 0.5 / 0.3 / 0.5 |
| 27 | 254 | 8795253 | 13.1 / 19.0 / 13.0 / 19.0 | 0.1 / 0.1 / 0.0 / 0.1 | 9.5 / 14.4 / 9.4 / 14.4 | 2.1 / 2.5 / 2.0 / 2.5 | 1.1 / 1.5 / 1.0 / 1.5 |
| 28 | 34 | 176807 | 0.5 / 0.9 / 0.5 / 0.9 | 0.1 / 0.1 / 0.1 / 0.1 | 0.2 / 0.6 / 0.2 / 0.6 | 0.2 / 0.2 / 0.2 / 0.2 | 0.0 / 0.0 / 0.0 / 0.0 |
| 29 | 81 | 1101425 | 2.1 / 4.2 / 1.8 / 4.2 | 0.1 / 0.2 / 0.0 / 0.2 | 1.2 / 2.7 / 1.0 / 2.7 | 0.6 / 0.9 / 0.5 / 0.9 | 0.1 / 0.2 / 0.1 / 0.2 |
| 30 | 83 | 1990924 | 3.3 / 6.1 / 3.1 / 6.1 | 0.1 / 0.1 / 0.0 / 0.1 | 2.2 / 4.4 / 2.0 / 4.4 | 0.8 / 1.1 / 0.8 / 1.1 | 0.2 / 0.4 / 0.2 / 0.4 |
| 31 | 112 | 894529 | 2.3 / 4.6 / 2.2 / 4.6 | 0.1 / 0.2 / 0.0 / 0.2 | 1.0 / 2.3 / 0.9 / 2.3 | 0.8 / 1.4 / 0.8 / 1.4 | 0.2 / 0.4 / 0.2 / 0.4 |
| 32 | 225 | 1716505 | 4.8 / 10.6 / 4.8 / 10.6 | 0.1 / 0.1 / 0.0 / 0.1 | 2.0 / 4.3 / 1.9 / 4.3 | 1.7 / 3.5 / 1.6 / 3.5 | 0.9 / 2.2 / 0.8 / 2.2 |
| 33 | 67 | 1731372 | 2.7 / 7.4 / 2.5 / 7.4 | 0.1 / 0.2 / 0.1 / 0.2 | 1.9 / 6.2 / 1.7 / 6.2 | 0.5 / 1.1 / 0.5 / 1.1 | 0.1 / 0.3 / 0.1 / 0.3 |
| 34 | 29 | 130718 | 0.4 / 1.5 / 0.4 / 1.5 | 0.1 / 0.2 / 0.0 / 0.2 | 0.2 / 1.0 / 0.2 / 1.0 | 0.1 / 0.3 / 0.1 / 0.3 | 0.0 / 0.1 / 0.0 / 0.1 |
| 35 | 95 | 651338 | 1.8 / 5.4 / 1.7 / 5.4 | 0.0 / 0.2 / 0.0 / 0.2 | 0.8 / 3.8 / 0.7 / 3.8 | 0.6 / 1.0 / 0.6 / 1.0 | 0.2 / 0.3 / 0.2 / 0.3 |
| 36 | 84 | 487318 | 1.3 / 1.9 / 1.2 / 1.9 | 0.1 / 0.1 / 0.0 / 0.1 | 0.6 / 1.1 / 0.5 / 1.1 | 0.5 / 0.5 / 0.5 / 0.5 | 0.1 / 0.1 / 0.1 / 0.1 |
| 37 | 201 | 1625084 | 4.2 / 8.7 / 3.9 / 8.7 | 0.1 / 0.2 / 0.0 / 0.2 | 1.9 / 5.0 / 1.7 / 5.0 | 1.4 / 2.0 / 1.3 / 2.0 | 0.6 / 1.2 / 0.6 / 1.2 |
| 38 | 153 | 13857244 | 18.6 / 28.6 / 17.4 / 28.6 | 0.1 / 0.1 / 0.0 / 0.1 | 15.5 / 24.8 / 14.4 / 24.8 | 2.2 / 2.6 / 2.1 / 2.6 | 0.7 / 1.0 / 0.6 / 1.0 |
| 39 | 29 | 117639 | 0.4 / 0.9 / 0.4 / 0.9 | 0.1 / 0.3 / 0.1 / 0.3 | 0.1 / 0.3 / 0.1 / 0.3 | 0.1 / 0.2 / 0.1 / 0.2 | 0.0 / 0.0 / 0.0 / 0.0 |
| 40 | 81 | 1722822 | 2.7 / 5.8 / 2.5 / 5.8 | 0.0 / 0.2 / 0.0 / 0.2 | 1.9 / 4.5 / 1.7 / 4.5 | 0.5 / 0.8 / 0.5 / 0.8 | 0.1 / 0.2 / 0.1 / 0.2 |
| 41 | 420 | 3068294 | 9.3 / 23.3 / 9.1 / 23.3 | 0.1 / 0.1 / 0.0 / 0.1 | 3.5 / 14.7 / 3.5 / 14.7 | 2.9 / 4.0 / 2.8 / 4.0 | 2.4 / 3.9 / 2.3 / 3.9 |
| 42 | 128 | 1041663 | 2.5 / 3.9 / 2.3 / 3.9 | 0.1 / 0.1 / 0.1 / 0.1 | 1.2 / 2.2 / 1.1 / 2.2 | 0.8 / 1.1 / 0.8 / 1.1 | 0.3 / 0.4 / 0.3 / 0.4 |
| 43 | 310 | 2670253 | 7.1 / 15.5 / 6.8 / 15.5 | 0.1 / 0.1 / 0.0 / 0.1 | 3.1 / 10.1 / 2.9 / 10.1 | 2.2 / 3.3 / 2.0 / 3.3 | 1.5 / 2.1 / 1.5 / 2.1 |
| 44 | 62 | 1724836 | 2.7 / 3.7 / 2.6 / 3.7 | 0.1 / 0.2 / 0.1 / 0.2 | 1.9 / 2.6 / 1.6 / 2.6 | 0.5 / 0.5 / 0.4 / 0.5 | 0.2 / 0.3 / 0.2 / 0.3 |
| 45 | 178 | 1356296 | 3.5 / 4.8 / 3.1 / 4.8 | 0.1 / 0.1 / 0.0 / 0.1 | 1.6 / 2.6 / 1.3 / 2.6 | 1.2 / 1.4 / 1.1 / 1.4 | 0.5 / 0.6 / 0.4 / 0.6 |
| 46 | 245 | 2048839 | 5.4 / 8.1 / 5.0 / 8.1 | 0.1 / 0.3 / 0.1 / 0.3 | 2.3 / 4.4 / 2.2 / 4.4 | 1.9 / 2.1 / 1.7 / 2.1 | 0.9 / 1.1 / 0.8 / 1.1 |

## Instrumentation overhead

Same Chromium actions and optimized bundles. Baseline includes lightweight CDP network and performance counters. Detailed runs add Rust spans, React profiling, DOM timing, CPU sampling and CDP timeline capture. Differences include machine load and run order.

| Case | Baseline n | Detailed n | Baseline ms | Detailed ms | Difference of medians |
|---|---:|---:|---:|---:|---:|
| cold | 5 | 5 | 1179.5 / 1645.0 / 1160.9 / 1645.0 | 1260.6 / 1297.3 / 1243.9 / 1297.3 | +81.0 ms |
| reload | 10 | 10 | 319.3 / 430.9 / 283.7 / 430.9 | 482.0 / 578.4 / 462.3 / 578.4 | +162.6 ms |
| switch | 10 | 10 | 149.7 / 151.3 / 133.7 / 151.3 | 180.4 / 211.1 / 171.5 / 211.1 | +30.7 ms |
| back | 10 | 10 | 141.7 / 151.6 / 133.7 / 151.6 | 176.3 / 185.5 / 169.2 / 185.5 | +34.6 ms |
| page | 10 | 10 | 108.1 / 120.5 / 101.1 / 120.5 | 124.8 / 150.0 / 120.4 / 150.0 | +16.7 ms |

## Renderer timings

Total duration per action in the detailed repeats, through the observation window. React actualDuration estimates rendering. Nested and repeated commits can share work with browser script and layout. Long tasks use the longest renderer-like RunTask events available in the CDP trace across threads, so the count is diagnostic.

| Case | React render ms | Commits | Inflate, base64 and UTF-8 ms | Replay JSON ms | Schema validation ms | Message unit construction ms |
|---|---:|---:|---:|---:|---:|---:|
| cold | 131.6 / 132.4 / 129.8 / 132.4 | 111.0 / 112.0 / 108.0 / 112.0 | 7.8 / 8.1 / 7.6 / 8.1 | 0.5 / 0.5 / 0.4 / 0.5 | 2.4 / 2.6 / 2.3 / 2.6 | 0.3 / 0.3 / 0.0 / 0.3 |
| reload | 68.1 / 77.0 / 63.8 / 77.0 | 97.5 / 100.0 / 96.0 / 100.0 | 7.3 / 7.6 / 7.2 / 7.6 | 0.5 / 0.5 / 0.4 / 0.5 | 1.8 / 2.0 / 1.6 / 2.0 | 0.1 / 0.2 / 0.0 / 0.2 |
| switch | 30.3 / 35.4 / 27.0 / 35.4 | 53.5 / 56.0 / 52.0 / 56.0 | 0.0 / 0.1 / 0.0 / 0.1 | 0.0 / 0.1 / 0.0 / 0.1 | 0.0 / 0.1 / 0.0 / 0.1 | 0.1 / 0.2 / 0.0 / 0.2 |
| back | 28.3 / 31.4 / 24.0 / 31.4 | 54.5 / 56.0 / 50.0 / 56.0 | 0.0 / 0.1 / 0.0 / 0.1 | 0.0 / 0.1 / 0.0 / 0.1 | 0.0 / 0.1 / 0.0 / 0.1 | 0.1 / 0.2 / 0.0 / 0.2 |
| page | 15.1 / 16.2 / 14.0 / 16.2 | 20.0 / 20.0 / 20.0 / 20.0 | 3.2 / 4.0 / 2.5 / 4.0 | 0.2 / 0.4 / 0.1 / 0.4 | 1.1 / 1.2 / 1.1 / 1.2 | 0.1 / 0.2 / 0.0 / 0.2 |
| subagent | 72.6 / 72.6 / 72.6 / 72.6 | 56.0 / 56.0 / 56.0 / 56.0 | 131.4 / 131.4 / 131.4 / 131.4 | 14.9 / 14.9 / 14.9 / 14.9 | 45.0 / 45.0 / 45.0 / 45.0 | 3.6 / 3.6 / 3.6 / 3.6 |

## Concurrent daemon stages

One detailed run per case. Each span ends at its daemon log timestamp. The raw data records absolute Unix milliseconds. Millisecond durations below are summed within the observation window, including spans that overlap. HTTP spans end when a handler returns its response. Body delivery continues in Chromium’s network trace. SQL spans cover the instrumented query helpers.

| Case | Stage | Calls | Sum ms | Per-call ms, median / p95 / min / max | First start → last end, ms from action |
|---|---|---:|---:|---:|---:|
| cold | adapter_history | 1 | 760.5 | 760.5 / 760.5 / 760.5 / 760.5 | 275.7 → 1036.2 |
| cold | daemon_history_inclusive | 1 | 786.8 | 786.8 / 786.8 / 786.8 / 786.8 | 266.4 → 1053.1 |
| cold | git_exec branch | 1 | 13.3 | 13.3 / 13.3 / 13.3 / 13.3 | 286.1 → 299.4 |
| cold | git_exec diff | 1 | 18.1 | 18.1 / 18.1 / 18.1 / 18.1 | 286.7 → 304.9 |
| cold | git_exec status | 1 | 13.1 | 13.1 / 13.1 / 13.1 / 13.1 | 286.4 → 299.4 |
| cold | git_exec worktree | 1 | 8.0 | 8.0 / 8.0 / 8.0 / 8.0 | 1069.5 → 1077.5 |
| cold | http_handler / | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 156.1 → 156.1 |
| cold | http_handler /acp/{profile} | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 323.3 → 323.3 |
| cold | http_handler /api/adapters | 2 | 32.3 | 16.1 / 21.5 / 10.7 / 21.5 | 202.3 → 254.3 |
| cold | http_handler /api/adapters/{adapterId}/agents | 1 | 0.1 | 0.1 / 0.1 / 0.1 / 0.1 | 343.8 → 343.9 |
| cold | http_handler /api/adapters/{adapterId}/skills | 1 | 0.2 | 0.2 / 0.2 / 0.2 / 0.2 | 343.8 → 344.0 |
| cold | http_handler /api/adapters/{adapter_id}/effective-model | 2 | 0.4 | 0.2 / 0.2 / 0.2 / 0.2 | 329.8 → 1230.5 |
| cold | http_handler /api/automation-interactions | 1 | 0.3 | 0.3 / 0.3 / 0.3 / 0.3 | 199.6 → 199.9 |
| cold | http_handler /api/chats | 4 | 2.6 | 0.6 / 1.0 / 0.4 / 1.0 | 200.6 → 1997.8 |
| cold | http_handler /api/chats/{chatId}/background-tasks | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 282.8 → 282.8 |
| cold | http_handler /api/chats/{id} | 1 | 0.4 | 0.4 / 0.4 / 0.4 / 0.4 | 263.7 → 264.2 |
| cold | http_handler /api/chats/{id}/resume | 1 | 805.0 | 805.0 / 805.0 / 805.0 / 805.0 | 264.5 → 1069.5 |
| cold | http_handler /api/chats/{id}/workflow-runs | 1 | 0.5 | 0.5 / 0.5 / 0.5 / 0.5 | 319.0 → 319.5 |
| cold | http_handler /api/commands | 1 | 0.1 | 0.1 / 0.1 / 0.1 / 0.1 | 231.0 → 231.2 |
| cold | http_handler /api/projects | 3 | 0.5 | 0.2 / 0.2 / 0.1 / 0.2 | 191.4 → 330.8 |
| cold | http_handler /api/projects/{id}/git/branch | 1 | 13.8 | 13.8 / 13.8 / 13.8 / 13.8 | 285.7 → 299.5 |
| cold | http_handler /api/projects/{id}/git/status | 1 | 13.4 | 13.4 / 13.4 / 13.4 / 13.4 | 286.1 → 299.5 |
| cold | http_handler /api/projects/{id}/git/working-stat | 1 | 18.4 | 18.4 / 18.4 / 18.4 / 18.4 | 286.5 → 304.9 |
| cold | http_handler /api/providers/cli-status | 2 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 202.5 → 233.7 |
| cold | http_handler /api/providers/{id}/quota | 4 | 0.1 | 0.0 / 0.0 / 0.0 / 0.0 | 202.5 → 233.5 |
| cold | http_handler /api/settings/providers | 1 | 0.4 | 0.4 / 0.4 / 0.4 / 0.4 | 284.5 → 284.9 |
| cold | http_handler /api/tags | 2 | 0.4 | 0.2 / 0.2 / 0.2 / 0.2 | 196.2 → 199.0 |
| cold | http_handler /api/tunnel/ports | 2 | 0.1 | 0.0 / 0.1 / 0.0 / 0.1 | 202.4 → 236.4 |
| cold | http_handler /health | 2 | 0.1 | 0.0 / 0.1 / 0.0 / 0.1 | 142.6 → 2148.7 |
| cold | mentions | 1 | 0.6 | 0.6 / 0.6 / 0.6 / 0.6 | 1078.1 → 1078.7 |
| cold | plan_and_skills | 1 | 671.3 | 671.3 / 671.3 / 671.3 / 671.3 | 1113.8 → 1785.1 |
| cold | plan_file_scan | 47 | 649.0 | 3.5 / 31.5 / 0.3 / 356.6 | 1114.4 → 1764.8 |
| cold | pr_scan | 1 | 35.0 | 35.0 / 35.0 / 35.0 / 35.0 | 1078.7 → 1113.7 |
| cold | replay_deflate | 1 | 1.8 | 1.8 / 1.8 / 1.8 / 1.8 | 1199.9 → 1201.7 |
| cold | replay_serialize | 1 | 0.3 | 0.3 / 0.3 / 0.3 / 0.3 | 1199.6 → 1199.8 |
| cold | resume_prepare_inclusive | 1 | 128.6 | 128.6 / 128.6 / 128.6 / 128.6 | 1070.9 → 1199.5 |
| cold | skill_file_scan | 47 | 669.3 | 3.8 / 31.5 / 0.4 / 370.5 | 1114.3 → 1784.9 |
| cold | snapshot_serialize | 1 | 61.8 | 61.8 / 61.8 / 61.8 / 61.8 | 1069.7 → 1131.5 |
| cold | snapshot_write | 1 | 48.2 | 48.2 / 48.2 / 48.2 / 48.2 | 1131.5 → 1179.7 |
| cold | source_fingerprint | 1 | 8.4 | 8.4 / 8.4 / 8.4 / 8.4 | 267.3 → 275.7 |
| cold | sql_all | 3 | 0.2 | 0.1 / 0.1 / 0.1 / 0.1 | 196.3 → 199.8 |
| cold | tail_lookup | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 1070.9 → 1071.0 |
| reload | git_exec branch | 1 | 38.5 | 38.5 / 38.5 / 38.5 / 38.5 | 193.7 → 232.2 |
| reload | git_exec diff | 1 | 38.4 | 38.4 / 38.4 / 38.4 / 38.4 | 194.1 → 232.5 |
| reload | git_exec status | 1 | 18.6 | 18.6 / 18.6 / 18.6 / 18.6 | 193.7 → 212.3 |
| reload | http_handler / | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 91.6 → 91.7 |
| reload | http_handler /acp/{profile} | 1 | 0.1 | 0.1 / 0.1 / 0.1 / 0.1 | 212.6 → 212.7 |
| reload | http_handler /api/adapters | 2 | 152.2 | 76.1 / 76.1 / 76.1 / 76.1 | 117.6 → 270.6 |
| reload | http_handler /api/adapters/{adapterId}/agents | 1 | 0.3 | 0.3 / 0.3 / 0.3 / 0.3 | 253.0 → 253.3 |
| reload | http_handler /api/adapters/{adapterId}/skills | 1 | 0.3 | 0.3 / 0.3 / 0.3 / 0.3 | 253.0 → 253.4 |
| reload | http_handler /api/adapters/{adapter_id}/effective-model | 2 | 0.9 | 0.5 / 0.7 / 0.2 / 0.7 | 232.6 → 301.6 |
| reload | http_handler /api/automation-interactions | 1 | 0.1 | 0.1 / 0.1 / 0.1 / 0.1 | 115.6 → 115.7 |
| reload | http_handler /api/chats | 3 | 2.2 | 0.7 / 0.8 / 0.6 / 0.8 | 116.5 → 399.6 |
| reload | http_handler /api/chats/{chatId}/background-tasks | 1 | 0.1 | 0.1 / 0.1 / 0.1 / 0.1 | 190.9 → 191.0 |
| reload | http_handler /api/chats/{id} | 1 | 0.1 | 0.1 / 0.1 / 0.1 / 0.1 | 174.3 → 174.3 |
| reload | http_handler /api/chats/{id}/resume | 1 | 40.1 | 40.1 / 40.1 / 40.1 / 40.1 | 174.2 → 214.3 |
| reload | http_handler /api/chats/{id}/workflow-runs | 1 | 1.0 | 1.0 / 1.0 / 1.0 / 1.0 | 212.6 → 213.6 |
| reload | http_handler /api/commands | 1 | 0.2 | 0.2 / 0.2 / 0.2 / 0.2 | 153.9 → 154.1 |
| reload | http_handler /api/projects | 3 | 1.6 | 0.6 / 0.8 / 0.2 / 0.8 | 107.0 → 233.4 |
| reload | http_handler /api/projects/{id}/git/branch | 1 | 40.6 | 40.6 / 40.6 / 40.6 / 40.6 | 191.8 → 232.4 |
| reload | http_handler /api/projects/{id}/git/status | 1 | 21.1 | 21.1 / 21.1 / 21.1 / 21.1 | 191.8 → 212.9 |
| reload | http_handler /api/projects/{id}/git/working-stat | 1 | 38.9 | 38.9 / 38.9 / 38.9 / 38.9 | 193.6 → 232.5 |
| reload | http_handler /api/providers/cli-status | 2 | 0.1 | 0.0 / 0.0 / 0.0 / 0.0 | 117.6 → 155.4 |
| reload | http_handler /api/providers/{id}/quota | 4 | 0.1 | 0.0 / 0.0 / 0.0 / 0.0 | 117.6 → 155.4 |
| reload | http_handler /api/settings/providers | 1 | 2.4 | 2.4 / 2.4 / 2.4 / 2.4 | 191.3 → 193.7 |
| reload | http_handler /api/tags | 2 | 0.2 | 0.1 / 0.1 / 0.1 / 0.1 | 112.6 → 115.1 |
| reload | http_handler /api/tunnel/ports | 2 | 0.2 | 0.1 / 0.1 / 0.1 / 0.1 | 134.6 → 155.3 |
| reload | http_handler /health | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 84.7 → 84.7 |
| reload | replay_deflate | 1 | 1.7 | 1.7 / 1.7 / 1.7 / 1.7 | 271.9 → 273.6 |
| reload | replay_serialize | 1 | 0.3 | 0.3 / 0.3 / 0.3 / 0.3 | 271.6 → 271.9 |
| reload | resume_prepare_inclusive | 1 | 18.6 | 18.6 / 18.6 / 18.6 / 18.6 | 252.9 → 271.5 |
| reload | sql_all | 3 | 0.1 | 0.0 / 0.0 / 0.0 / 0.0 | 112.6 → 115.6 |
| reload | tail_lookup | 1 | 0.6 | 0.6 / 0.6 / 0.6 / 0.6 | 252.9 → 253.5 |
| switch | git_exec branch | 1 | 8.4 | 8.4 / 8.4 / 8.4 / 8.4 | 62.1 → 70.5 |
| switch | git_exec diff | 1 | 7.6 | 7.6 / 7.6 / 7.6 / 7.6 | 63.1 → 70.7 |
| switch | git_exec status | 1 | 8.1 | 8.1 / 8.1 / 8.1 / 8.1 | 62.6 → 70.7 |
| switch | http_handler /api/adapters/{adapter_id}/effective-model | 1 | 0.1 | 0.1 / 0.1 / 0.1 / 0.1 | 61.2 → 61.3 |
| switch | http_handler /api/chats | 2 | 1.2 | 0.6 / 0.8 / 0.5 / 0.8 | 143.3 → 344.8 |
| switch | http_handler /api/chats/{chatId}/background-tasks | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 59.8 → 59.9 |
| switch | http_handler /api/chats/{id}/resume | 1 | 5.3 | 5.3 / 5.3 / 5.3 / 5.3 | 37.0 → 42.3 |
| switch | http_handler /api/projects/{id}/git/branch | 1 | 8.7 | 8.7 / 8.7 / 8.7 / 8.7 | 61.9 → 70.6 |
| switch | http_handler /api/projects/{id}/git/status | 1 | 8.5 | 8.5 / 8.5 / 8.5 / 8.5 | 62.4 → 70.9 |
| switch | http_handler /api/projects/{id}/git/working-stat | 1 | 7.9 | 7.9 / 7.9 / 7.9 / 7.9 | 62.9 → 70.8 |
| switch | http_handler /health | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 550.3 → 550.3 |
| switch | replay_deflate | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 82.0 → 82.0 |
| switch | replay_serialize | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 82.0 → 82.0 |
| switch | resume_prepare_inclusive | 1 | 2.4 | 2.4 / 2.4 / 2.4 / 2.4 | 79.4 → 81.8 |
| switch | tail_lookup | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 79.4 → 79.4 |
| back | git_exec branch | 1 | 12.0 | 12.0 / 12.0 / 12.0 / 12.0 | 53.7 → 65.7 |
| back | git_exec diff | 1 | 15.5 | 15.5 / 15.5 / 15.5 / 15.5 | 54.9 → 70.4 |
| back | git_exec status | 1 | 11.4 | 11.4 / 11.4 / 11.4 / 11.4 | 54.2 → 65.7 |
| back | http_handler /api/adapters/{adapter_id}/effective-model | 1 | 0.1 | 0.1 / 0.1 / 0.1 / 0.1 | 52.8 → 53.0 |
| back | http_handler /api/chats | 2 | 2.2 | 1.1 / 1.7 / 0.5 / 1.7 | 132.8 → 333.9 |
| back | http_handler /api/chats/{chatId}/background-tasks | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 51.4 → 51.4 |
| back | http_handler /api/chats/{id}/resume | 1 | 1.6 | 1.6 / 1.6 / 1.6 / 1.6 | 27.9 → 29.6 |
| back | http_handler /api/projects/{id}/git/branch | 1 | 12.3 | 12.3 / 12.3 / 12.3 / 12.3 | 53.5 → 65.8 |
| back | http_handler /api/projects/{id}/git/status | 1 | 11.7 | 11.7 / 11.7 / 11.7 / 11.7 | 54.1 → 65.8 |
| back | http_handler /api/projects/{id}/git/working-stat | 1 | 15.8 | 15.8 / 15.8 / 15.8 / 15.8 | 54.7 → 70.5 |
| back | replay_deflate | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 72.1 → 72.1 |
| back | replay_serialize | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 72.1 → 72.1 |
| back | resume_prepare_inclusive | 1 | 2.3 | 2.3 / 2.3 / 2.3 / 2.3 | 69.7 → 72.0 |
| back | tail_lookup | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 69.7 → 69.7 |
| page | replay_deflate | 1 | 0.8 | 0.8 / 0.8 / 0.8 / 0.8 | 76.4 → 77.1 |
| page | replay_serialize | 1 | 0.1 | 0.1 / 0.1 / 0.1 / 0.1 | 76.2 → 76.4 |
| subagent | http_handler /api/chats/{chatId}/background-tasks | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 14.4 → 14.4 |
| subagent | http_handler /api/projects | 2 | 0.5 | 0.3 / 0.3 / 0.2 / 0.3 | 11.1 → 498.5 |
| subagent | http_handler /api/projects/{id}/launch/configs | 1 | 0.6 | 0.6 / 0.6 / 0.6 / 0.6 | 11.3 → 11.9 |
| subagent | http_handler /api/projects/{id}/launch/status | 1 | 0.4 | 0.4 / 0.4 / 0.4 / 0.4 | 11.8 → 12.2 |
| subagent | http_handler /api/projects/{id}/tree | 1 | 1.2 | 1.2 / 1.2 / 1.2 / 1.2 | 14.8 → 16.1 |
| subagent | replay_deflate | 18 | 58.0 | 2.8 / 6.4 / 1.8 / 6.4 | 116.0 → 188.0 |
| subagent | replay_serialize | 18 | 11.3 | 0.6 / 0.9 / 0.5 / 0.9 | 115.5 → 185.0 |
| cold | adapter_history | 1 | 698.9 | 698.9 / 698.9 / 698.9 / 698.9 | 242.6 → 941.4 |
| cold | daemon_history_inclusive | 1 | 722.0 | 722.0 / 722.0 / 722.0 / 722.0 | 234.5 → 956.5 |
| cold | git_exec branch | 1 | 10.9 | 10.9 / 10.9 / 10.9 / 10.9 | 254.5 → 265.4 |
| cold | git_exec diff | 1 | 16.0 | 16.0 / 16.0 / 16.0 / 16.0 | 255.8 → 271.8 |
| cold | git_exec status | 1 | 14.8 | 14.8 / 14.8 / 14.8 / 14.8 | 255.1 → 269.9 |
| cold | git_exec worktree | 1 | 9.3 | 9.3 / 9.3 / 9.3 / 9.3 | 971.2 → 980.5 |
| cold | http_handler / | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 108.2 → 108.2 |
| cold | http_handler /acp/{profile} | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 293.4 → 293.5 |
| cold | http_handler /api/adapters | 2 | 30.5 | 15.2 / 19.7 / 10.8 / 19.7 | 158.8 → 214.5 |
| cold | http_handler /api/adapters/{adapterId}/agents | 1 | 0.2 | 0.2 / 0.2 / 0.2 / 0.2 | 324.0 → 324.1 |
| cold | http_handler /api/adapters/{adapterId}/skills | 1 | 0.3 | 0.3 / 0.3 / 0.3 / 0.3 | 323.9 → 324.2 |
| cold | http_handler /api/adapters/{adapter_id}/effective-model | 2 | 0.4 | 0.2 / 0.2 / 0.2 / 0.2 | 304.9 → 1152.0 |
| cold | http_handler /api/automation-interactions | 1 | 0.2 | 0.2 / 0.2 / 0.2 / 0.2 | 156.3 → 156.5 |
| cold | http_handler /api/chats | 4 | 2.2 | 0.5 / 0.8 / 0.4 / 0.8 | 157.9 → 1990.9 |
| cold | http_handler /api/chats/{chatId}/background-tasks | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 250.6 → 250.6 |
| cold | http_handler /api/chats/{id} | 1 | 0.7 | 0.7 / 0.7 / 0.7 / 0.7 | 231.0 → 231.7 |
| cold | http_handler /api/chats/{id}/resume | 1 | 738.8 | 738.8 / 738.8 / 738.8 / 738.8 | 232.4 → 971.2 |
| cold | http_handler /api/chats/{id}/workflow-runs | 1 | 0.8 | 0.8 / 0.8 / 0.8 / 0.8 | 293.3 → 294.1 |
| cold | http_handler /api/commands | 1 | 0.1 | 0.1 / 0.1 / 0.1 / 0.1 | 192.6 → 192.7 |
| cold | http_handler /api/projects | 3 | 0.5 | 0.1 / 0.3 / 0.1 / 0.3 | 146.2 → 305.9 |
| cold | http_handler /api/projects/{id}/git/branch | 1 | 11.3 | 11.3 / 11.3 / 11.3 / 11.3 | 254.3 → 265.6 |
| cold | http_handler /api/projects/{id}/git/status | 1 | 15.0 | 15.0 / 15.0 / 15.0 / 15.0 | 254.9 → 270.0 |
| cold | http_handler /api/projects/{id}/git/working-stat | 1 | 16.3 | 16.3 / 16.3 / 16.3 / 16.3 | 255.6 → 271.9 |
| cold | http_handler /api/providers/cli-status | 2 | 0.1 | 0.0 / 0.1 / 0.0 / 0.1 | 159.3 → 195.9 |
| cold | http_handler /api/providers/{id}/quota | 4 | 0.1 | 0.0 / 0.1 / 0.0 / 0.1 | 158.9 → 195.8 |
| cold | http_handler /api/settings/providers | 1 | 0.6 | 0.6 / 0.6 / 0.6 / 0.6 | 252.7 → 253.3 |
| cold | http_handler /api/tags | 2 | 0.4 | 0.2 / 0.2 / 0.1 / 0.2 | 152.2 → 155.9 |
| cold | http_handler /api/tunnel/ports | 2 | 0.1 | 0.0 / 0.0 / 0.0 / 0.0 | 159.5 → 196.4 |
| cold | http_handler /health | 2 | 0.1 | 0.0 / 0.1 / 0.0 / 0.1 | 95.9 → 2108.4 |
| cold | mentions | 1 | 0.5 | 0.5 / 0.5 / 0.5 / 0.5 | 980.8 → 981.3 |
| cold | plan_and_skills | 1 | 765.0 | 765.0 / 765.0 / 765.0 / 765.0 | 1016.9 → 1782.0 |
| cold | plan_file_scan | 47 | 742.8 | 3.7 / 32.0 / 0.3 / 438.8 | 1017.6 → 1762.1 |
| cold | pr_scan | 1 | 35.5 | 35.5 / 35.5 / 35.5 / 35.5 | 981.3 → 1016.8 |
| cold | replay_deflate | 1 | 1.7 | 1.7 / 1.7 / 1.7 / 1.7 | 1116.5 → 1118.2 |
| cold | replay_serialize | 1 | 0.3 | 0.3 / 0.3 / 0.3 / 0.3 | 1116.2 → 1116.5 |
| cold | resume_prepare_inclusive | 1 | 143.4 | 143.4 / 143.4 / 143.4 / 143.4 | 972.7 → 1116.0 |
| cold | skill_file_scan | 47 | 762.3 | 3.7 / 31.1 / 0.4 / 451.7 | 1017.7 → 1781.8 |
| cold | snapshot_serialize | 1 | 61.5 | 61.5 / 61.5 / 61.5 / 61.5 | 971.8 → 1033.3 |
| cold | snapshot_write | 1 | 55.2 | 55.2 / 55.2 / 55.2 / 55.2 | 1033.4 → 1088.6 |
| cold | source_fingerprint | 1 | 7.5 | 7.5 / 7.5 / 7.5 / 7.5 | 235.0 → 242.5 |
| cold | sql_all | 3 | 0.2 | 0.1 / 0.1 / 0.0 / 0.1 | 152.3 → 156.5 |
| cold | tail_lookup | 1 | 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 972.7 → 972.7 |

## First view and idle

On the diagnostic pass, quiet means the start of 500 ms without a captured network event, React commit-count change, mounted-row count change or loading-state change. The check samples every 40 ms and gives up at eight seconds. This measures browser quiet. Daemon jobs can continue afterwards.

| Case | View ms | Composer verified ms | Start of quiet window ms | Last network event before view ms |
|---|---:|---:|---:|---:|
| cold | 1695.9 | 1756.8 | 2226.8 | 1234.1 |
| reload | 438.6 | 499.4 | 507.1 | 403.3 |
| switch | 180.4 | 227.9 | 614.3 | 155.2 |
| back | 171.9 | 217.7 | 348.4 | 142.9 |
| page | 149.6 | — | 234.8 | 87.0 |
| subagent | 699.4 | — | 744.1 | 674.5 |
| first-switch | 191.3 | 236.5 | 283.3 | 75.0 |

## Traffic through first view and observation end

Counts and bytes are medians. WebSocket payload sizes use UTF-8 text-frame lengths. HTTP sizes use the encodedDataLength reported on body completion. A response that straddles a marker is counted at completion.

| Case | HTTP completed / bytes to view | WS received / bytes to view | WS sent / bytes to view | WS received / bytes at end |
|---|---:|---:|---:|---:|
| cold | 52 / 4,465,603 | 9 / 188,705 | 3 / 531 | 11 / 195,537 |
| reload | 53 / 23,223 | 11 / 195,537 | 3 / 531 | 11 / 195,537 |
| first-switch | 6.5 / 3,146 | 8 / 192,004 | 4 / 396 | 8 / 192,004 |
| back | 6 / 2,538 | 8 / 7,650 | 4 / 500 | 8 / 7,650 |
| page | 0 / 0 | 1 / 84,541 | 1 / 184 | 1 / 84,541 |
| subagent | 6 / 2,800 | 1 / 8,762,470 | 1 / 231 | 1 / 8,762,470 |

## Automation and event timing

The principal table includes the Playwright locator and actionability wait. For cases with a captured relevant DOM click, the following table also measures from that click. The reload and cold totals start earlier at navigation. An edit marker includes Playwright focus, typing and verification. It bounds how late the composer became usable.

| Case | Samples with click marker | Click to view, ms |
|---|---:|---:|
| cold | 5 | 860.7 / 1310.8 / 844.1 / 1310.8 |
| reload | 10 | 131.6 / 212.6 / 71.8 / 212.6 |
| first-switch | 10 | 147.2 / 212.7 / 146.9 / 212.7 |
| back | 10 | 106.0 / 115.7 / 97.4 / 115.7 |
| page | 10 | 71.6 / 80.4 / 63.7 / 80.4 |

## Daemon timing across repeated opens

Each cell gives the sum of one stage across a single trial, then median / p95 / min / max across the trials. Spans count when they finish before observation ends. Concurrent scans and inclusive parent spans remain separate.

| Case | Stage | Trials with completions | Calls per trial | Milliseconds per trial |
|---|---|---:|---:|---:|
| cold | adapter_history | 5 / 5 | 1.0 / 1.0 / 1.0 / 1.0 | 684.1 / 705.8 / 675.3 / 705.8 |
| cold | daemon_history_inclusive | 5 / 5 | 1.0 / 1.0 / 1.0 / 1.0 | 710.1 / 728.6 / 698.2 / 728.6 |
| cold | git_exec | 5 / 5 | 4.0 / 4.0 / 4.0 / 4.0 | 49.0 / 57.1 / 41.4 / 57.1 |
| cold | http_handler | 5 / 5 | 35.0 / 35.0 / 35.0 / 35.0 | 801.6 / 829.8 / 778.3 / 829.8 |
| cold | mentions | 5 / 5 | 1.0 / 1.0 / 1.0 / 1.0 | 0.5 / 0.7 / 0.4 / 0.7 |
| cold | plan_and_skills | 5 / 5 | 1.0 / 1.0 / 1.0 / 1.0 | 667.7 / 689.5 / 652.2 / 689.5 |
| cold | plan_file_scan | 5 / 5 | 47.0 / 47.0 / 47.0 / 47.0 | 646.3 / 666.6 / 631.1 / 666.6 |
| cold | pr_scan | 5 / 5 | 1.0 / 1.0 / 1.0 / 1.0 | 34.4 / 35.4 / 33.8 / 35.4 |
| cold | replay_deflate | 5 / 5 | 1.0 / 1.0 / 1.0 / 1.0 | 1.7 / 1.8 / 1.6 / 1.8 |
| cold | replay_serialize | 5 / 5 | 1.0 / 1.0 / 1.0 / 1.0 | 0.3 / 0.3 / 0.3 / 0.3 |
| cold | resume_prepare_inclusive | 5 / 5 | 1.0 / 1.0 / 1.0 / 1.0 | 113.2 / 119.9 / 107.6 / 119.9 |
| cold | skill_file_scan | 5 / 5 | 47.0 / 47.0 / 47.0 / 47.0 | 665.5 / 687.5 / 650.0 / 687.5 |
| cold | snapshot_serialize | 5 / 5 | 1.0 / 1.0 / 1.0 / 1.0 | 60.5 / 61.0 / 58.8 / 61.0 |
| cold | snapshot_write | 5 / 5 | 1.0 / 1.0 / 1.0 / 1.0 | 47.0 / 71.3 / 45.9 / 71.3 |
| cold | source_fingerprint | 5 / 5 | 1.0 / 1.0 / 1.0 / 1.0 | 7.8 / 9.2 / 7.4 / 9.2 |
| cold | sql_all | 5 / 5 | 3.0 / 3.0 / 3.0 / 3.0 | 0.2 / 0.2 / 0.1 / 0.2 |
| cold | tail_lookup | 5 / 5 | 1.0 / 1.0 / 1.0 / 1.0 | 0.0 / 0.1 / 0.0 / 0.1 |
| reload | git_exec | 10 / 10 | 3.0 / 3.0 / 3.0 / 3.0 | 70.5 / 242.6 / 63.3 / 242.6 |
| reload | http_handler | 10 / 10 | 35.0 / 35.0 / 35.0 / 35.0 | 280.3 / 588.7 / 250.1 / 588.7 |
| reload | replay_deflate | 10 / 10 | 1.0 / 1.0 / 1.0 / 1.0 | 1.7 / 2.3 / 1.6 / 2.3 |
| reload | replay_serialize | 10 / 10 | 1.0 / 1.0 / 1.0 / 1.0 | 0.4 / 0.5 / 0.3 / 0.5 |
| reload | resume_prepare_inclusive | 10 / 10 | 1.0 / 1.0 / 1.0 / 1.0 | 2.9 / 45.6 / 2.1 / 45.6 |
| reload | sql_all | 10 / 10 | 3.0 / 3.0 / 3.0 / 3.0 | 0.1 / 0.2 / 0.1 / 0.2 |
| reload | tail_lookup | 10 / 10 | 1.0 / 1.0 / 1.0 / 1.0 | 0.6 / 42.4 / 0.5 / 42.4 |
| switch | git_exec | 10 / 10 | 3.0 / 3.0 / 3.0 / 3.0 | 40.6 / 77.6 / 23.4 / 77.6 |
| switch | http_handler | 10 / 10 | 9.0 / 9.0 / 8.0 / 9.0 | 56.1 / 94.1 / 31.0 / 94.1 |
| switch | replay_deflate | 10 / 10 | 1.0 / 1.0 / 1.0 / 1.0 | 0.0 / 0.1 / 0.0 / 0.1 |
| switch | replay_serialize | 10 / 10 | 1.0 / 1.0 / 1.0 / 1.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| switch | resume_prepare_inclusive | 10 / 10 | 1.0 / 1.0 / 1.0 / 1.0 | 2.7 / 4.8 / 2.0 / 4.8 |
| switch | tail_lookup | 10 / 10 | 1.0 / 1.0 / 1.0 / 1.0 | 0.0 / 0.1 / 0.0 / 0.1 |
| back | git_exec | 10 / 10 | 3.0 / 3.0 / 3.0 / 3.0 | 38.6 / 52.6 / 25.0 / 52.6 |
| back | http_handler | 10 / 10 | 8.0 / 8.0 / 7.0 / 8.0 | 42.3 / 55.7 / 29.0 / 55.7 |
| back | replay_deflate | 10 / 10 | 1.0 / 1.0 / 1.0 / 1.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| back | replay_serialize | 10 / 10 | 1.0 / 1.0 / 1.0 / 1.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| back | resume_prepare_inclusive | 10 / 10 | 1.0 / 1.0 / 1.0 / 1.0 | 2.8 / 5.3 / 2.0 / 5.3 |
| back | tail_lookup | 10 / 10 | 1.0 / 1.0 / 1.0 / 1.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| page | http_handler | 10 / 10 | 1.0 / 1.0 / 1.0 / 1.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| page | replay_deflate | 10 / 10 | 1.0 / 1.0 / 1.0 / 1.0 | 0.8 / 1.0 / 0.7 / 1.0 |
| page | replay_serialize | 10 / 10 | 1.0 / 1.0 / 1.0 / 1.0 | 0.1 / 0.2 / 0.1 / 0.2 |
| page | sql_all | 1 / 10 | 0.0 / 1.0 / 0.0 / 1.0 | 0.0 / 0.0 / 0.0 / 0.0 |

## Browser trace events

CDP duration events are grouped by action. Paint can run on multiple threads. Durations across threads and nested events can overlap. CPU profiles for the named build are under data/ as .cpuprofile files.

| Case | Event | Number per trial | Total ms per trial |
|---|---|---:|---:|
| cold | Layout | 74.0 / 75.0 / 73.0 / 75.0 | 28.4 / 29.2 / 28.3 / 29.2 |
| cold | UpdateLayoutTree | 136.0 / 137.0 / 132.0 / 137.0 | 25.8 / 26.1 / 25.1 / 26.1 |
| cold | Paint | 65.0 / 66.0 / 61.0 / 66.0 | 10.2 / 11.1 / 9.9 / 11.1 |
| cold | Commit | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| cold | RunTask ≥ 50 ms | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| reload | Layout | 72.0 / 74.0 / 69.0 / 74.0 | 15.1 / 15.8 / 12.2 / 15.8 |
| reload | UpdateLayoutTree | 113.5 / 117.0 / 107.0 / 117.0 | 20.3 / 21.6 / 19.0 / 21.6 |
| reload | Paint | 65.0 / 69.0 / 62.0 / 69.0 | 4.6 / 5.0 / 4.3 / 5.0 |
| reload | Commit | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| reload | RunTask ≥ 50 ms | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| switch | Layout | 33.0 / 33.0 / 33.0 / 33.0 | 6.1 / 6.7 / 5.8 / 6.7 |
| switch | UpdateLayoutTree | 56.0 / 60.0 / 55.0 / 60.0 | 10.7 / 11.5 / 10.0 / 11.5 |
| switch | Paint | 31.0 / 32.0 / 31.0 / 32.0 | 2.2 / 2.3 / 2.1 / 2.3 |
| switch | Commit | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| switch | RunTask ≥ 50 ms | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| back | Layout | 33.0 / 33.0 / 33.0 / 33.0 | 6.0 / 6.3 / 5.7 / 6.3 |
| back | UpdateLayoutTree | 57.0 / 60.0 / 53.0 / 60.0 | 9.7 / 10.6 / 9.1 / 10.6 |
| back | Paint | 31.0 / 31.0 / 30.0 / 31.0 | 2.2 / 2.5 / 2.1 / 2.5 |
| back | Commit | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| back | RunTask ≥ 50 ms | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| page | Layout | 17.0 / 17.0 / 17.0 / 17.0 | 4.9 / 5.2 / 4.7 / 5.2 |
| page | UpdateLayoutTree | 43.5 / 45.0 / 41.0 / 45.0 | 6.4 / 7.2 / 6.1 / 7.2 |
| page | Paint | 20.0 / 22.0 / 20.0 / 22.0 | 2.7 / 3.3 / 2.4 / 3.3 |
| page | Commit | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| page | RunTask ≥ 50 ms | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| subagent | Layout | 48.0 / 48.0 / 48.0 / 48.0 | 28.2 / 28.2 / 28.2 / 28.2 |
| subagent | UpdateLayoutTree | 80.0 / 80.0 / 80.0 / 80.0 | 21.1 / 21.1 / 21.1 / 21.1 |
| subagent | Paint | 248.0 / 248.0 / 248.0 / 248.0 | 16.5 / 16.5 / 16.5 / 16.5 |
| subagent | Commit | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| subagent | RunTask ≥ 50 ms | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| first-switch | Layout | 33.0 / 33.0 / 33.0 / 33.0 | 10.3 / 10.3 / 10.3 / 10.3 |
| first-switch | UpdateLayoutTree | 65.0 / 65.0 / 65.0 / 65.0 | 10.3 / 10.3 / 10.3 / 10.3 |
| first-switch | Paint | 33.0 / 33.0 / 33.0 / 33.0 | 2.4 / 2.4 / 2.4 / 2.4 |
| first-switch | Commit | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 |
| first-switch | RunTask ≥ 50 ms | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 |
