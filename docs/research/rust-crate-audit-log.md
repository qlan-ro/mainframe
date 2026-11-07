# Rust crate audit log

The nightly code-audit run picks one crate under `packages/core-rs/crates`,
fixes what it finds in one PR, and records the crate here. Pick a crate that
is not listed yet, or the one audited longest ago. Follow-ups are findings
the run left open because they cross a crate or wire boundary.

| Date | Crate | PR | Follow-ups |
|---|---|---|---|
| 2026-10-21 | `mainframe-git` | #861 | `update_all` reports a failed pull of the current branch as `up-to-date` (`UpdateAllResult` has no failure variant; needs a types + UI change). The git diff route builds `{base}..HEAD` from a query value without an option guard (`mainframe-server/src/routes/git.rs`). Merge results report the auto-merged file count as `commits`. |
| 2026-11-07 | `mainframe-runtime` | # | `~/.mainframe` is created `0755`, so other local users can list it and read `mainframe.db` and the logs. A `config.json` with one invalid field (for example `port: 70000`) still fails as a whole: the daemon mints a new auth secret and devices must re-pair, though the old file now survives as `config.json.invalid.<timestamp>`. `tunnel_manager.rs` `next_line_stdout`/`next_line_stderr` drop the reader on non-UTF-8 output, the bug fixed here in `spawn_line_pump`. `write_workspace_trust` replaces a symlinked `~/.claude.json` with a regular file. `save_config` runs sync file I/O inside async tunnel handlers. `finish_pumps` and `PumpTasks` still abort a pump after the grace period, so a job left holding a `ManagedProcess` pipe dies on SIGPIPE; `run_captured` now keeps draining instead. |
