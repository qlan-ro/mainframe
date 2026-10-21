# Rust crate audit log

The nightly code-audit run picks one crate under `packages/core-rs/crates`,
fixes what it finds in one PR, and records the crate here. Pick a crate that
is not listed yet, or the one audited longest ago. Follow-ups are findings
the run left open because they cross a crate or wire boundary.

| Date | Crate | PR | Follow-ups |
|---|---|---|---|
| 2026-10-21 | `mainframe-git` | #861 | `update_all` reports a failed pull of the current branch as `up-to-date` (`UpdateAllResult` has no failure variant; needs a types + UI change). The git diff route builds `{base}..HEAD` from a query value without an option guard (`mainframe-server/src/routes/git.rs`). Merge results report the auto-merged file count as `commits`. |
