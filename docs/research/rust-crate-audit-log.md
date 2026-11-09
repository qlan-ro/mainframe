# Rust crate audit log

The nightly code-audit run picks one crate under `packages/core-rs/crates`,
fixes what it finds in one PR, and records the crate here. Pick a crate that
is not listed yet, or the one audited longest ago. Follow-ups are findings
the run left open because they cross a crate or wire boundary.

| Date | Crate | PR | Follow-ups |
|---|---|---|---|
| 2026-10-21 | `mainframe-git` | #861 | `update_all` reports a failed pull of the current branch as `up-to-date` (`UpdateAllResult` has no failure variant; needs a types + UI change). The git diff route builds `{base}..HEAD` from a query value without an option guard (`mainframe-server/src/routes/git.rs`). Merge results report the auto-merged file count as `commits`. |
| 2026-11-09 | `mainframe-db` | #887 | `DevicesRepository::update_last_seen` has no caller, so `mainframe status` shows every paired device as last seen "never" (wire it at the server's device-auth check). Removing a project deletes its chats but keeps their `delegated_tasks` rows (the table has no foreign keys), so `list_owed` can return a task whose parent chat is gone. `get_pending_fork` fails on a corrupt `pending_fork` value while every other JSON column logs and falls back to a default; settle the policy with the fork flow in `mainframe-chat`. Enums persist three ways (`SqlEnum` serde, `as_db_str`/`from_db_str` for segments, `as_str`/`parse` for orchestration); converge them in `mainframe-types`. |
