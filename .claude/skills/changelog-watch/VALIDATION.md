# Validation replay (AC-3)

Replays the skill over the historical Codex range containing the
`thread/tokenUsage/updated` change — the drift that motivated this todo —
without touching `state.json`. Rerun this after any edit to
`classification.md` or to `docs/adapters/codex/CONSUMED-SURFACE.md`; it is
the only regression gate over the model-driven classification step.

## Command

```bash
node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool codex \
  --since rust-v0.63.0 --max 1 --out /tmp/replay-codex.md
```

Expected fetch: exactly one release, `rust-v0.64.0` (2025-12-02, the oldest
stable release after the anchor — pinned by test 8 of
`scripts/changelog-delta.test.mjs`), truncated with
`nextAnchor: rust-v0.64.0`, body containing the literal line
`- [app-server] add thread/tokenUsage/updated v2 event by @celia-oai in #7268`.

## Pass condition

The classification of `/tmp/replay-codex.md` per `classification.md` against
`docs/adapters/codex/CONSUMED-SURFACE.md` must flag the #7268 entry as a
**compatibility risk** that:

- maps to checklist row **CODEX-EVT-04** (`thread/tokenUsage/updated`),
- names `packages/core-rs/crates/mainframe-adapter-codex/src/types.rs::TokenUsageUpdatedParams`
  as the affected consumer, and
- recommends a regression test extending
  `packages/core-rs/crates/mainframe-adapter-codex/tests/event_mapper.rs`.

If the replay fails, fix `classification.md` (relevance filter or routing)
or the CODEX-EVT-04 row — never the report — and rerun.

## Replay of 2026-07-25

Fetch behaved as expected (1 entry, `rust-v0.63.0 -> rust-v0.145.0` head,
truncated at `rust-v0.64.0`, `#7268` present; `state.json` checksum
unchanged). Classification of the 79-PR release body:

**Target entry** — `[app-server] add thread/tokenUsage/updated v2 event
(#7268)`: routed via `token usage` → CODEX-EVT-04. **Compatibility risk,
high** — the v2 event carries `tokenUsage: {total, last, modelContextWindow}`
while the consumer `src/types.rs::TokenUsageUpdatedParams`
(`packages/core-rs/crates/mainframe-adapter-codex/src/types.rs`) requires a
top-level snake_case `usage` object; deserialization fails inside
`if let Ok(p)` in `src/event_mapper.rs::handle_token_usage`, so
`state.last_usage` silently never updates and Codex sessions lose their
context percentage. Recommended regression test: extend
`packages/core-rs/crates/mainframe-adapter-codex/tests/event_mapper.rs` with
the v2 payload, asserting the deserialized token totals (not merely `Ok`).
Verify live via `.claude/skills/codex-protocol-debugger/` before any fix.

**Other risks (low)** — #7124/#7408 (`thread_id`/`turn_id` added to all item
and error notifications) touch shapes CODEX-EVT-01/CODEX-ITEM-01
deserialize; additive-only, and lenient deserialization tolerates extra
fields (`tests/item_types.rs::sub_agent_activity_tolerates_an_unknown_extra_field`),
so no action beyond noting.

**Adoption opportunities** — `turn/diff/updated` (#7279), `turn/plan/updated`
(#7329), `item/fileChange/outputDelta` (#7399): all land in the
CODEX-EVT-02 known-but-ignored set. App-server config management (#7241):
new RPC surface, no row. `thread/compacted` (#7289) and the `ImageView` item
(#7468) are the historical introductions of surfaces Mainframe has since
adopted (CODEX-EVT-01, CODEX-ITEM-01) — flagged by the run, already rows;
a fresh run today would treat their like as opportunities.

**Dropped: 68 entries** — TUI, Windows/WSL, sandbox policy internals, MCP
shell-tool, CI/deps/docs/CLA, flaky-test and session-recycling chores. None
names a surface a checklist row cites.

**Verdict: PASS** — the target entry was flagged as a compatibility risk,
mapped to CODEX-EVT-04, attributed to `TokenUsageUpdatedParams`, with the
regression test pointed at `tests/event_mapper.rs`. The mapping came from
the routing table and the checklist row, not from a worked example:
`classification.md` deliberately excludes this entry (see its Worked
examples section), so the gate tests generalization.
