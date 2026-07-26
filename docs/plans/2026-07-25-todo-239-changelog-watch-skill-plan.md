# Todo #239 — changelog-watch skill (implementation plan)

**Worktree:** `/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/todo-239-changelog-watch-skill`
**Branch:** `todo/239-changelog-watch-skill`
**Route:** `route:no-spec` — the todo's Agent Brief is the contract.

## Goal

Build an on-demand skill that answers one question per run: what changed in Claude Code and Codex
since Mainframe last looked, and what does it mean for Mainframe's adapters? The skill fetches the
Claude Code `CHANGELOG.md` and the Codex GitHub release bodies, slices only the entries newer than a
per-tool anchor held in a committed state file, and classifies every surviving entry against a
repo-tracked checklist of what Mainframe actually consumes from each CLI — spawn flags, stream-json
event types, `control_request`/`control_response` kinds, app-server JSON-RPC methods and
notifications, on-disk session formats, and prose-sensitive parsers. The output is a triage-ready
report in which each compatibility risk names the checklist row it threatens, the Rust consumer that
would break, and the regression test to add or extend; each adoption opportunity names an upstream
capability Mainframe could surface; and entries with no Mainframe relevance are counted, not listed.
Building the consumed-surface checklist is part of this work. Fixing drift the first run finds is
not — each finding becomes its own todo.

## Verified facts (checked in this worktree and against the upstreams, 2026-07-25)

Every design choice below rests on one of these. Re-check any that look stale before deviating.

1. **Claude Code publishes a real changelog.** `anthropics/claude-code/CHANGELOG.md` is 477 KB with
   352 `## <version>` sections, newest first, bare versions (`## 2.1.219`), no dates. Fetches
   anonymously from `raw.githubusercontent.com`. Its GitHub releases carry the same text under
   `v<semver>` tags **with** `published_at` dates. → **changelog mode** for Claude; releases are only
   a date cross-reference.
2. **Codex does not.** `openai/codex/CHANGELOG.md` is a 93-byte stub pointing at the releases page.
   → **releases mode** via `gh api repos/openai/codex/releases`.
3. **Codex prereleases are noise.** `rust-v0.146.0-alpha.*` bodies are 25 bytes. Stable bodies run
   10–26 KB. Default `includePrerelease: false`.
4. **Codex tags disagree with `--version`.** Tags are `rust-v0.145.0`; `codex --version` prints
   `codex-cli 0.144.3`. The state record needs a `tagPrefix`.
5. **The GitHub releases list is not ordered by `published_at`.** Observed: `rust-v0.146.0-alpha.3.1`
   (2026-07-23T23:26Z) is returned *after* `alpha.5` (2026-07-23T20:02Z). Any anchor logic must sort
   by `published_at` descending before slicing.
6. **Protocol changes only ever appear in the raw per-PR list of a Codex release body**, never in the
   curated top sections. Verified anchor for the validation replay: release **`rust-v0.64.0`**
   (2025-12-02, stable, 10111-byte body) contains, at body line 84,
   `- [app-server] add thread/tokenUsage/updated v2 event by @celia-oai in #7268`. The preceding
   stable release is `rust-v0.63.0`. A delta extractor that keeps only curated sections would miss
   every protocol change — it must pass release bodies through whole.
7. **The drift the todo cites is live in the shipped Rust daemon.**
   `packages/core-rs/crates/mainframe-adapter-codex/src/types.rs:212-218` declares
   `TokenUsageUpdatedParams { thread_id, usage: Usage }` with `usage` **required**, and `Usage`
   (`types.rs:309-318`) is snake_case `input_tokens`/`cached_input_tokens`/`output_tokens`. Current
   Codex sends `tokenUsage: { total, last, modelContextWindow }` — a shape that appears in the crate
   only as framing input to a stderr/JSON-RPC test (`src/jsonrpc.rs:594`), never as a deserialization
   pin. `event_mapper.rs:108-112` deserializes inside `if let Ok(p)`, so the mismatch is swallowed
   and `state.last_usage` stays `None` (`handle_token_usage`, `event_mapper.rs:313-319`). The
   percentage formula survives only in the retired TS tree
   (`packages/core/src/plugins/builtin/codex/token-usage.ts:21-26`); there is no Rust equivalent.
   A porting note at `types.rs:449-452` records the same hazard from the TS side. **Second, related
   gap:** `src/adapter.rs:25` hardcodes `context_window: None` for every Codex model, so even the
   fallback branch of `packages/ui/src/features/chat/thread/session-bar-status.ts::deriveContextPct`
   returns `null`. This plan **records** both findings (T4 row, T14 todos); fixing them is out of
   scope per the brief.
8. **The protocol docs the brief names as ground truth do not exist.** `docs/adapters/` contains only
   `claude/CLEAR.md`. `CLAUDE.md:23` and `AGENTS.md:9` link `PROTOCOL_REVERSED.md`, `COMPACTION.md`,
   `INTERRUPT.md`, `CONTEXT_USAGE.md`, `MODELS.md`, `TODOS.md`, `PR_TRACKING.md` — all absent.
   Ground truth is therefore the Rust adapter crates plus `.claude/skills/{claude,codex}-protocol-debugger/`.
9. **The sibling skills the brief cites as user-level are in-repo.** `git ls-files .claude` lists
   `.claude/skills/claude-protocol-debugger/` and `.claude/skills/codex-protocol-debugger/` as
   tracked; only `claude-source-researcher` is user-level (`~/.claude/skills/`). See D1.
10. **Tooling scope.** `*.md` is in `.prettierignore`; lint-staged formats `*.{json,yml,yaml}` and
    lints only `*.{ts,tsx}`; `.mjs` is neither hook-formatted nor hook-linted but is *not*
    prettier-ignored, so `pnpm exec prettier --check` applies. Node 24 (`.nvmrc`), so `node --test`
    needs no runner dependency. CI (`ci.yml`) runs typecheck + three vitest projects + changeset
    check; `rust-port.yml` runs `cargo fmt --check`, `clippy -D warnings`, `cargo test` — so
    regression tests recommended in Rust crates do gate PRs.
11. **No CLI version is pinned anywhere.** Both adapters probe `--version` at runtime. This work
    introduces the first "version we reviewed against" record. Locally installed today:
    `claude 2.1.219`, `codex-cli 0.144.3`.
12. **Seed anchors that produce a real first run.** Claude ships ~1 release/day; `v2.1.206`
    (2026-07-10) is ~14 days back. Codex stable releases newer than the installed `0.144.3` are
    `rust-v0.144.4/.5/.6` and `rust-v0.145.0` (25.7 KB body). Seeding at those two anchors gives the
    first run genuine material instead of an empty delta (see D8).

## Decisions

Brief recommendations are adopted unless the row says otherwise.

| # | Question | Decision |
|---|---|---|
| D1 | Skill location | **Deviation from the brief.** In-repo `.claude/skills/changelog-watch/`, not `~/.claude/skills/`. The brief's rationale was "matching claude-source-researcher and the other protocol-debugger skills"; fact 9 shows both protocol-debugger skills are already in-repo and git-tracked. The state file and the checklists are repo artifacts that must version with the adapters and be reviewable in a PR, and this branch is the delivery vehicle — a user-level skill could not be committed on it at all. |
| D2 | On-demand vs scheduled | Adopted as recommended: on-demand, with a stateful delta design so scheduling later is config, not a rewrite. No automation wiring now. |
| D3 | Live protocol probing | Adopted as recommended: changelog analysis only. Risky findings point at `.claude/skills/{claude,codex}-protocol-debugger/` for verification. |
| D4 | Checklist ground truth | **Forced deviation** (fact 8). Rows anchor to Rust adapter crate `file::symbol` pairs plus the surviving `CLEAR.md` and the two protocol-debugger skills. T15 repoints the dead links rather than shipping a checklist ecosystem that references absent files. |
| D5 | Checklist location | `docs/adapters/<tool>/CONSUMED-SURFACE.md`, beside the existing `docs/adapters/claude/CLEAR.md`. Docs, not skill-internal: the checklist must be updated by anyone changing an adapter, whether or not they know the skill exists. |
| D6 | Report persistence | Reports and fetched deltas are ephemeral triage input: written to `.claude/skills/changelog-watch/reports/` (gitignored) and summarized in session. The durable records are the committed `state.json` and the todos filed from the report. Committing every report would churn the repo and drag the changeset gate onto unrelated branches. |
| D7 | Prose-only skill vs helper script | A small Node ESM helper does the mechanical slicing; the model does the judgement. Slicing a 477 KB changelog by hand every run is both wasteful and non-reproducible. Pure functions, unit-tested with `node --test` (no new dependency, no code inside the orphaned `packages/core`). |
| D8 | Seed anchors | Claude `2.1.206`, Codex `rust-v0.144.3` (fact 12). Seeding both at HEAD would make the first run empty by construction and leave AC-1 undemonstrated. The Codex anchor is the version actually installed and thus last exercised; the Claude anchor is ~2 weeks back, a window small enough to classify in a few passes. |
| D9 | CI for the helper tests | Add one `node --test` step to the existing `typecheck` job in `ci.yml`. Without it the tests never run anywhere and rot within a month. It needs no build and no new job. |
| D10 | Invocation | Model-invoked (no `disable-model-invocation`) plus a `CLAUDE.md` Skills-table row, so a dependency refresh or adapter change can reach it without the operator remembering it exists. |
| D11 | Filing findings as todos | T14, isolated and skippable, so the branch can ship without writing to the tracker if the operator prefers to file by hand. |

## Constraints

- **≤300 lines/file, ≤50 lines/function** applies to every artifact here, markdown included.
- **This work adds no daemon route, no Rust code, no React.** The repo rules on Zod envelopes,
  `ok`/`okEmpty`/`fail`, Rust route parity, and `data-testid` have no surface here — do not invent
  one. `cargo check` and the UI typecheck are unaffected; do not add them as gates.
- **No shell interpolation.** The fetch CLI uses `execFile('gh', [...])` with array args. Never a
  template-string shell command.
- **No silent catches.** The helper throws or returns an explicit status field; the CLI prints one
  line and exits non-zero. No empty `catch {}`.
- `.mjs` and `.json` artifacts must pass `pnpm exec prettier --check`; `*.md` is prettier-ignored.
- ESLint's flat config applies the repo's `no-console` rule to `.mjs` as well as `.ts`. Keep every
  `console.log` in `fetch-delta.mjs` only — never in the pure module (T7) — and if `pnpm lint` ever
  starts covering the file, the CLI is the one place a warning is acceptable.
- `docs/plans/` is gitignored: this plan file is intentionally untracked and is not part of the
  commit.
- Comments explain *why*, not *what*. No `@ts-ignore`/`@ts-expect-error` needed (no TypeScript here).

## Deliverables

| Path | Task |
|---|---|
| `docs/adapters/README.md` | T1 |
| `docs/adapters/claude/CONSUMED-SURFACE.md` | T2, T3 |
| `docs/adapters/codex/CONSUMED-SURFACE.md` | T4 |
| `.claude/skills/changelog-watch/state.json`, `.gitignore` | T5 |
| `.claude/skills/changelog-watch/scripts/changelog-delta.test.mjs` + `fixtures/` | T6 |
| `.claude/skills/changelog-watch/scripts/changelog-delta.mjs` | T7 |
| `.claude/skills/changelog-watch/scripts/fetch-delta.mjs` | T8 |
| `.github/workflows/ci.yml` | T9 |
| `.claude/skills/changelog-watch/classification.md` | T10 |
| `.claude/skills/changelog-watch/SKILL.md` | T11 |
| `.claude/skills/changelog-watch/VALIDATION.md` | T12 |
| (gitignored run artifacts + a `state.json` commit) | T13 |
| todos in the tracker | T14 |
| `CLAUDE.md`, `AGENTS.md` | T15 |
| `.changeset/<name>.md` | T16 |

## Task graph

```
T1 ─┬─ T2 ── T3          (same file, sequential)
    └─ T4
T5 ── T6 ── T7 ── T8 ── T9
                   │
(T3,T4,T8) ──────► T10 ── T11 ── T12 ── T13 ── T14
T15  (independent)                        └──── T16 (last)
```

Parallel: T1 ∥ T5 ∥ T15. Then T2 ∥ T4 (different files). T6→T7 is TDD order; T7→T8 is a hard
dependency (the CLI imports the module); T12→T13 is deliberate — the pinned replay validates the
classification rules before the live run consumes them.

---

## T1 — Checklist format and ID scheme

**Creates:** `docs/adapters/README.md` (≤80 lines)
**Parallel with:** T5, T15.

Define the format once so T2/T3/T4 and the skill agree.

- What a consumed-surface checklist is: the upstream CLI behaviours Mainframe depends on, each
  anchored to the code that depends on it.
- Row schema (markdown table):
  `ID | Surface | Upstream artifact | Mainframe consumer (file::symbol) | Coverage | Verified | Breakage symptom`.
  - *Mainframe consumer* cites `path::symbol`, **not** line numbers — line numbers rot within weeks
    and the verification greps for the symbol. Two citation forms only, because the validator
    resolves exactly these: bare `src/…` or `tests/…` for files in the crate the file documents
    (`mainframe-adapter-claude` or `mainframe-adapter-codex`), and a **full** worktree-relative
    `packages/…` path for anything else — another crate, the types crate, a UI mirror. Never a
    shorthand like `mainframe-background-tasks/src/encoding.rs`; it resolves against neither root and
    would slip through unchecked.
  - *Coverage* names the existing test that would fail, or `none`. This column is what makes the
    skill's "recommended regression test" concrete rather than a platitude. **Only Rust unit and
    integration tests count.** The e2e recordings in `packages/e2e/fixtures/recordings/` replay
    Mainframe's *adapter API* (`onInit`, `onMessage`, `onCompact`), not raw CLI wire shapes, so they
    keep passing after an upstream protocol break — never cite them as coverage.
  - *Verified* is the CLI version a row was last confirmed against, where the code records one
    (e.g. `adapter.rs` notes the CLI reporting `maxTokens 967,000`; `probe_models.rs` notes
    "live-verified against CLI 2.1.198"; `cli-binary-internals.md` carries stamps for 2.1.83, 2.1.85,
    2.1.118, 2.1.156, 2.1.198 and 2.1.202). Write `—` when nothing records one; do not invent a
    version.
  - *Breakage symptom* is the user-visible failure in one clause.
- Each tool file ends with a short **"Not consumed — adoption candidates"** section listing upstream
  capabilities Mainframe deliberately does not use (Claude: `--include-partial-messages`,
  `--session-id`, `--settings`, `--mcp-config`, `--agents`, `--fork-session`, `hook_callback` and
  `mcp_message` control subtypes; Codex: the ignored notification set and the `codex/event/*`
  namespace). Without it the skill has nothing to map an adoption opportunity onto.
- ID grammar: `<TOOL>-<CAT>-<NN>` where `TOOL ∈ {CLAUDE, CODEX}`,
  `CAT ∈ {FLAG, EVT, CTRL, RPC, ITEM, FILE, PROBE, IO}` (`IO` = stdio transport and log-line
  conventions), `NN` zero-padded.
  IDs are permanent: never renumber. A surface Mainframe stops consuming is marked `retired` in
  place, so IDs cited by old reports and todos stay resolvable.
- Update protocol: changing what Mainframe consumes from a CLI updates the row in the same PR.
- Budget: ≤300 lines and ≤30 rows per tool file. Collapse variant families (the Codex `ThreadItem`
  union, the Claude JSONL field set) into one row pointing at the enum or parser; do not enumerate
  every variant.
- Pointers: `.claude/skills/changelog-watch/SKILL.md` is the consumer of these files;
  `.claude/skills/{claude,codex}-protocol-debugger/` are how you verify a suspected change.
- State explicitly that `docs/rust-port/CONTRACT/*.json` is Mainframe's *own* daemon↔client wire
  contract, not an upstream CLI surface, so the two never get conflated.

**Verify:**

```bash
cd <worktree>
wc -l docs/adapters/README.md            # ≤ 80
grep -c 'Breakage symptom' docs/adapters/README.md   # ≥ 1 (schema row present)
grep -qE '<TOOL>-<CAT>-<NN>' docs/adapters/README.md
```

## T2 — Claude checklist, part A: spawn, events, control protocol

**Creates:** `docs/adapters/claude/CONSUMED-SURFACE.md` (rows through `CLAUDE-CTRL-*`)
**Depends on:** T1. **Parallel with:** T4. **Followed by:** T3 (same file).

Source of truth: `packages/core-rs/crates/mainframe-adapter-claude/`. Open the crate's `src/lib.rs`
doc comment first — it states that unknown inbound event types are logged once and skipped, never
fatal. Quote that property in the file header, alongside the fact that **there is no typed enum for
stream-json events**: `src/events.rs` compares `serde_json::Value` string fields throughout. Silent
degradation on unknown or renamed upstream input is precisely why a changelog watcher is needed.

Rows required in this pass:

- `CLAUDE-FLAG-01` — session argv from `src/session.rs::build_args`, order preserved:
  `--output-format stream-json`, `--input-format stream-json`, `--verbose`,
  `--permission-prompt-tool stdio`, `--replay-user-messages`, optional `--append-system-prompt`,
  `--resume`, `--model`, `--permission-mode <default|acceptEdits|bypassPermissions|plan>`,
  `--allow-dangerously-skip-permissions`. Include the spawn environment from
  `src/session.rs::build_spawn_command` (resolved login-shell `PATH`, `FORCE_COLOR=0`, `NO_COLOR=1`,
  `CLAUDECODE` removed) and the two negative assertions the crate's tests already pin: the older
  `--dangerously-skip-permissions` spelling is *not* used, and `--effort` is *not* used (effort
  travels via `apply_flag_settings`). Both are rows the skill must check against renames.
- `CLAUDE-FLAG-02` — auxiliary argv: model probe (`src/probe_models.rs`), quota pull
  (`src/quota_pull.rs::spawn_claude_usage`), title generator (`src/title_generator.rs`). Record the
  `--no-session-persistence` and `--output-format text` dependencies explicitly; both are
  undocumented flags whose removal upstream would break these paths silently.
- `CLAUDE-EVT-01..05` — the stream-json top-level types dispatched in `src/events.rs`: `system`
  (`handle_system_event` — `init`, `compact_boundary`, `task_started`, `task_updated`,
  `task_notification` with its `usage.{total_tokens,tool_uses,duration_ms}`, plus
  `status == "compacting"`), `assistant` (`src/assistant_event.rs`, including the `TodoWrite`,
  `TaskCreate|TaskUpdate|TaskStop`, `Bash` and `Skill` `tool_use` special cases), `user`
  (`src/user_event.rs` — `isCompactSummary`, `isReplay`, `isMeta`, `toolUseResult`,
  `<local-command-stdout>`), `result` (`handle_result_event`: `result`, `total_cost_usd`, `usage`,
  `subtype`, `is_error`; subagent results dropped by `parent_tool_use_id`; context tokens taken only
  from the last parent assistant `usage`), and `rate_limit_event` (`handle_rate_limit_event`).
- `CLAUDE-EVT-06` — **`stream_event` is deliberately not handled**: Mainframe never passes
  `--include-partial-messages`, so there is no partial/delta path. Record it as a live row, not an
  omission: an upstream change that makes partial streaming default-on would flood the dispatcher.
- `CLAUDE-IO-01` — **stderr as a consumed surface** (`src/events.rs`, filters and classifiers at the
  top of the file): the noise filters (`debugger`, `warning:`, `deprecationwarning`,
  `experimentalwarning`, `(node:\d+)`, `Cloning into`) and the two semantic matches
  `is_trust_not_trusted` ("has not been trusted") and `is_trust_permissions` ("permissions.allow" /
  "hastrustdialogaccepted"). These are plain-English matches on CLI error copy — the single most
  fragile item in the inventory, and a `high` severity target for the classifier.
- `CLAUDE-IO-02` — the stdin envelopes Mainframe writes (`src/session.rs::send_message` and
  `send_command`): the `{"type":"user","session_id":…,"message":{…},"parent_tool_use_id":null}` frame,
  the `text` and `image` content blocks, the optional `uuid` that pairs with
  `--replay-user-messages`, and the CLI's slash-command XML wrapper
  (`<command-name>`/`<command-message>`/`<command-args>`).
- `CLAUDE-CTRL-01` — inbound `control_request`: only `subtype == "can_use_tool"` is handled
  (`src/events.rs`; fields `request_id`, `tool_name`, `tool_use_id`, `input`,
  `permission_suggestions`, `decision_reason`). Every other subtype is logged and ignored — record
  that, because a new upstream subtype is an adoption opportunity, not a break.
- `CLAUDE-CTRL-02` — inbound `control_response`: the **double-wrapped** `response.response.…` nesting
  that both the context-usage sniff (`totalTokens`, `maxTokens`, `percentage`) and the model probe
  depend on, plus the terminal-detection predicates in `src/session.rs` (`is_terminal_ctrl` on the
  outer `subtype`, `has_cancelled_flag` on the nested `response.cancelled`) and the 5-second default
  request timeout in `src/session_control.rs`.
- `CLAUDE-CTRL-03` — outbound `control_request` subtypes, all via
  `src/session_control.rs::ControlRequestChannel::send`: `interrupt`, `stop_task`,
  `get_context_usage`, `set_permission_mode`, `set_model`, `apply_flag_settings` (payload from
  `src/tuning.rs::tuning_to_flag_settings`: `effortLevel`, `fastMode`, `ultracode`,
  `alwaysThinkingEnabled`), `cancel_async_message`, and `initialize` (`src/probe_models.rs`).
  Record the interrupt escalation — protocol `interrupt`, then per-task `stop_task`, then a 10-second
  SIGINT fallback (`src/session.rs`) — as a workaround for CLI 2.1.85 behaviour documented in
  `.claude/skills/claude-protocol-debugger/cli-binary-internals.md`. An upstream fix makes that
  fallback harmful, so it is a watch item in both directions.
- `CLAUDE-CTRL-04` — the permission answer envelope Mainframe writes
  (`src/session.rs::respond_to_permission`: `behavior`, the capital-ID `toolUseID`, `updatedInput`,
  `updatedPermissions`, `message`, `interrupt`), including the deny-message copy the CLI expects for
  `ExitPlanMode` and `AskUserQuestion`, and the suggestion-destination rewrite
  (`promote_to_local_settings`, which maps `session` → `localSettings` across all six
  `ControlUpdate` variants in `packages/core-rs/crates/mainframe-types/src/adapter.rs`).
  Cross-reference the UI mirror
  `packages/ui/src/features/chat/gates/build-control-response.ts`, which carries the "`updatedInput`
  is required on every allow" constraint.

Fill *Coverage* from the crate's `#[cfg(test)]` modules and
`tests/apply_tool_grouping_characterization.rs`. Write `none` where there is no test — those cells
are the skill's highest-value regression-test recommendations, so do not paper over them.

**Verify:** every row cites at least one consumer, every cited file exists, and every cited symbol is
actually in it. Write the validator to `/tmp/check-surface.py` once — T3 and T4 rerun it as-is.
Citations are crate-relative (`src/…`, `tests/…`) per T1's schema and resolve against the crate root
passed as the second argument; the cross-crate and UI citations that start with `packages/` resolve
from the worktree root.

```bash
cd <worktree>
cat > /tmp/check-surface.py <<'PY'
import re, pathlib, sys
doc, crate = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
CITE = re.compile(r'(?<![\w./-])((?:packages/|src/|tests/)[\w./-]+\.(?:rs|ts|tsx))(?:::(\w+))?')
bad, rows = [], 0
for line in doc.read_text().splitlines():
    if not re.match(r'\|\s*(CLAUDE|CODEX)-', line):
        continue
    rows += 1
    cites = CITE.findall(line)
    if not cites:
        bad.append(f'NO CITATION: {line[:60]}')
    for path, sym in cites:
        p = pathlib.Path(path) if path.startswith('packages/') else crate / path
        if not p.exists(): bad.append(f'MISSING FILE {p}')
        elif sym and sym not in p.read_text(): bad.append(f'MISSING SYMBOL {p}::{sym}')
if rows == 0:
    bad.append('NO ROWS MATCHED - the table format does not match the schema')
print('\n'.join(sorted(set(bad))) or f'OK ({rows} rows)')
PY
python3 /tmp/check-surface.py docs/adapters/claude/CONSUMED-SURFACE.md \
  packages/core-rs/crates/mainframe-adapter-claude
grep -c '^| CLAUDE-' docs/adapters/claude/CONSUMED-SURFACE.md   # ≥ 14 after this task
```

The validator must print `OK (<n> rows)` with `n ≥ 14` — it fails loudly on zero rows, so it cannot
pass on an empty or malformed file. Every row must also have a non-empty Coverage cell.

Dry-run during planning against synthetic rows and the real crate: `src/session.rs::build_args` and
the `packages/ui/…/build-control-response.ts` citation resolved clean, a bogus `src/nope.rs` was
reported `MISSING FILE`, a row with prose instead of a citation was reported `NO CITATION`, and an
empty file was reported `NO ROWS MATCHED`. The T9 `awk` check was dry-run the same way (passes only
when the step sits inside the `typecheck` job), as was T8's `node -p` JSON extraction.

## T3 — Claude checklist, part B: session files, probes, prose parsers

**Edits:** `docs/adapters/claude/CONSUMED-SURFACE.md` (appends rows; ≤300 lines total, ≤30 rows)
**Depends on:** T2.

- `CLAUDE-FILE-01..06` — transcript path (`src/transcript.rs`), projects-dir scan and cwd encoding
  (`src/external_session_paths.rs`, `src/external_sessions.rs`), head/tail enrichment
  (`src/external_session_enrich.rs`), history load and conversion (`src/history.rs`,
  `src/history_converters.rs`, `src/history_tool_result.rs`), subagent linking
  (`src/history_subagents.rs` — record that CLI 2.1.118+ moved the link from `parentToolUseID` to the
  parent tool_result's `toolUseResult.agentId`; that is the Claude-side precedent for this whole
  todo), `~/.claude.json` identity and trust (`src/trust_store.rs`), skills/commands/agents/plugins
  discovery (`src/skills.rs`, `src/skill_path.rs`), and background-task spool paths
  (`src/task_events.rs` with
  `packages/core-rs/crates/mainframe-background-tasks/src/spool_root.rs::spool_root`).
- `CLAUDE-FILE-07` — **three divergent implementations of "encode a cwd the way the CLI does"**, all
  reverse-engineered from the same upstream behavior, so one upstream change breaks three files
  independently: `src/transcript.rs::encode_project_path` (keeps `-`, replaces every other
  non-alphanumeric), `src/external_session_paths.rs::encode_path` (replaces every non-alphanumeric,
  including `-`), and
  `packages/core-rs/crates/mainframe-background-tasks/src/encoding.rs::encode_cwd_segment` (replaces
  only `/` and `.`). Cite all three in the full form the T1 schema requires — the validator resolves
  bare `src/…` against the Claude crate, so a shorthand cross-crate path would go unchecked. The row
  lists all three consumers so a changelog hit fans out to each. File the inconsistency itself as a
  todo in T14 — do not "fix" it here.
- `CLAUDE-FILE-08` — spool root
  (`packages/core-rs/crates/mainframe-background-tasks/src/spool_root.rs::spool_root`):
  `/tmp/claude-{uid}`, `%TEMP%/claude` on Windows, `CLAUDE_CODE_TMPDIR` overrides the base. Record the
  live defect in the Breakage-symptom cell: `current_uid()` is a `TODO(port)` stub returning `None`,
  so production falls back to `claude-0` — wrong on any non-root daemon. T14 files it.
- The "Not consumed" section must state that `~/.claude/projects/*/sessions-index.json` and
  `~/.claude/todos/` are **not** read (Mainframe scans `*.jsonl` directly and takes todos from the
  TodoWrite tool stream), so upstream changes to either are noise, not risk. Likewise
  `src/pr_detection.rs` reads Bash **tool inputs**, not a CLI protocol surface — an upstream change
  cannot break it; keep it out of the table entirely.
- `CLAUDE-PROBE-01` — `claude --version` parsing (`src/adapter.rs`) and the `initialize` model probe
  (`src/probe_models.rs::extract_probe_payload`, reading
  `response.response.models[].{value,displayName,description,resolvedModel}`), plus
  `probe_models.rs::map_model_info`, which additionally reads `supportedEffortLevels`,
  `supportsFastMode`, and `supportsAdaptiveThinking` (the last two gate the composer's fast-mode and
  ultracode affordances, so a rename degrades the UI silently rather than erroring).
- `CLAUDE-PROBE-02` — the hardcoded fallback model catalog and context windows in `src/adapter.rs`
  (`claude_models`, `DEFAULT_CONTEXT_WINDOW`, `EXTENDED_CONTEXT_WINDOW`) and the hardcoded
  tool-category lists (`src/adapter.rs::get_tool_categories`, duplicated in
  `src/messages/display_pipeline.rs`). New upstream models and renamed tools land here — this is the
  row that makes "new model released" an adoption opportunity rather than an invisible no-op.
- `CLAUDE-PROBE-03` — **prose-sensitive parsers**, the highest-risk rows because upstream wording
  changes break them without any error: quota output anchors (`src/quota_parse.rs`), rate-limit
  mapping (`src/quota_rate_limit.rs`: `five_hour`, `seven_day`, `seven_day_opus`,
  `seven_day_sonnet`; utilization 0–1, `resetsAt` epoch seconds), the AskUserQuestion
  prefixes/suffixes (`src/messages/parse_ask_user_question.rs`), and
  `src/user_event.rs::COMPACT_SUMMARY_PREAMBLE`.

**Verify:** rerun T2's validator (`python3 /tmp/check-surface.py docs/adapters/claude/CONSUMED-SURFACE.md
packages/core-rs/crates/mainframe-adapter-claude` — still `OK`, now with ≥ 25 rows), plus:

```bash
wc -l docs/adapters/claude/CONSUMED-SURFACE.md              # ≤ 300
grep -c '^| CLAUDE-' docs/adapters/claude/CONSUMED-SURFACE.md   # 25–30 rows
awk -F'|' '/^\| CLAUDE-/ && $6 ~ /^ *$/ {print "EMPTY COVERAGE: " $2}' \
  docs/adapters/claude/CONSUMED-SURFACE.md                 # prints nothing
```

## T4 — Codex consumed-surface checklist

**Creates:** `docs/adapters/codex/CONSUMED-SURFACE.md` (new directory; ≤300 lines, ≤25 rows)
**Depends on:** T1. **Parallel with:** T2/T3.

Source: `packages/core-rs/crates/mainframe-adapter-codex/`.

- `CODEX-RPC-*` — methods Mainframe calls (`src/session.rs`): `initialize`/`initialized`,
  `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`, `thread/read`; plus `model/list`
  (`src/adapter.rs`) and `account/rateLimits/read` / `account/read` (`src/quota_pull.rs`). Record the
  params actually sent — `persistExtendedHistory`, `experimentalRawEvents`,
  `collaborationMode.settings.*`, `serviceTier`, `personality`, `summary`
  (`src/turn_config.rs`) — since the protocol-debugger skill already documents that two of them are
  required and silently fatal when omitted.
- `CODEX-EVT-*` — the nine notifications dispatched in `src/event_mapper.rs::handle_notification`:
  `thread/started`, `turn/started`, `item/started`, `item/completed`, `item/plan/delta`,
  `turn/completed`, `thread/tokenUsage/updated`, `thread/compacted`, `account/rateLimits/updated`.
  Plus **one** row for the explicitly-ignored set (`turn/diff/updated`, `turn/plan/updated`,
  `thread/closed`, `thread/status/changed`, the four `*Delta` streams, `thread/name/updated`), whose
  members are the standing adoption-opportunity list; and **one** row for the blanket
  `method.starts_with("codex/event/")` drop, which discards the entire raw-event namespace Mainframe
  itself opts into via `experimentalRawEvents: true`.
- The `thread/tokenUsage/updated` row **must carry the known drift** (fact 7): consumer
  `src/types.rs::TokenUsageUpdatedParams` + `src/event_mapper.rs::handle_token_usage`; shape =
  legacy, required snake_case `usage`; Coverage = `tests/event_mapper.rs`; breakage symptom = "no
  context percentage on Codex sessions"; and a `KNOWN DRIFT` note citing `src/jsonrpc.rs:594` (the
  current wire shape, present only as framing input), the porting note at `src/types.rs:449-452`, and
  the companion `context_window: None` gap at `src/adapter.rs:25`. This row is the target the T12
  replay must hit.
- `CODEX-ITEM-*` — the 18-variant `ThreadItem` union (`src/item_types.rs`, payload fields in
  `src/thread_item_variants.rs`) as **one** row. Note that seven variants were added for Codex
  0.144.3 — this is the highest-churn mapping point in the adapter — and that
  `src/types.rs::deserialize_lenient_items` drops unknown variants, so upstream item additions
  degrade silently rather than erroring.
- `CODEX-CTRL-*` — server→client requests in `src/approval_handler.rs`
  (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
  `item/tool/requestUserInput`), the request fields read (`itemId`, `command`, `cwd`, `reason`,
  `questions[].{id,question}`, `options[][].label`), the `{ decision }` / `{ answers }` reply shapes,
  and the unknown-method fallback that auto-declines.
- `CODEX-FLAG-*` — `src/session.rs::build_app_server_command`: argv is exactly `<binary> app-server`;
  everything else is negotiated over JSON-RPC. Record the env (`FORCE_COLOR=0`, `NO_COLOR=1`,
  resolved login-shell `PATH`) and the turn-config vocabularies in `src/turn_config.rs`
  (`personality ∈ {none,friendly,pragmatic}`, `reasoning_summary ∈ {auto,concise,detailed,none}`,
  `service_tier` only ever `"fast"`).
- `CODEX-EVT-*` (one more row) — **stdout/stderr conventions**, `src/jsonrpc.rs`: multiple
  concatenated JSON objects per line, and the stderr classifiers `is_rfc3339_prefix`,
  `is_tracing_line` (`TRACE|DEBUG|INFO|WARN|ERROR`), `is_panic_line` (`thread '…' panicked`). These
  are prose-shaped heuristics over another program's log format — the Codex equivalent of Claude's
  prose parsers, and they break without any error.
- `CODEX-FILE-*` — rollout JSONL under `~/.codex/sessions/**` (`src/external_sessions.rs` for the
  `rollout-<ts>-<uuid>.jsonl` name and `YYYY/MM/DD/` layout, `src/external_session_parse.rs` for the
  `session_meta` head record and the stripped preamble prefixes, `src/rollout_reader.rs` for the
  `{type, payload}` envelope and the six payload `type`s, `src/rollout_reconstruct.rs` for the
  `exec_command` / `mcp__` / `apply_patch` conventions); `~/.codex/state_5.sqlite`
  (`src/thread_registry.rs`, with the exact `SELECT id, agent_nickname, agent_role, rollout_path FROM
  threads` — note the `_5` in the filename is an upstream schema version, so a bump is itself a
  breaking signal); and `~/.codex/auth.json` (`src/quota_identity.rs`, `{tokens:{account_id}}`).
  Record that no `config.toml` is read and `codexHome` from `initialize` is never used to locate one.
- `CODEX-PROBE-*` — `codex --version` and `src/adapter.rs::parse_version` (a hand-rolled scan for the
  first `N.N.N` triple: a prefixed build number would mis-parse), `model/list` field mapping in
  `src/adapter.rs::map_codex_model` (`displayName`, `description`, `isDefault`,
  `supportedReasoningEfforts`, `defaultReasoningEffort`, `additionalSpeedTiers` containing `"fast"`,
  `supportsPersonality`, `hidden`), and the hardcoded tool categories (`todo_list`, `CollabAgent`).
- Quota row — `src/quota_rate_limit.rs` keys normalization on `windowDurationMins` (`300` → session,
  `10080` → weekly, anything else dropped) and converts `resetsAt` seconds to ms. A new upstream
  window duration is silently discarded.
- One UI-side note row for hardcoded protocol enums that must track `turn/start`:
  `packages/ui/src/features/settings/panes/providers/CodexTuningDefaults.tsx`
  (`SUMMARY_OPTIONS`, `PERSONALITY_OPTIONS`).

Coverage cells come from `tests/{event_mapper,item_types,history,child_tail,approval_handler,
rollout_reader,external_sessions,list_models,quota_notification}.rs` and the crate's inline
`#[cfg(test)]` modules. Record in the file header that the crate ships **no fixture directory** —
every test builds payloads inline — which is why "add a regression test" recommendations must name a
test file and the payload to pin, not just say "add coverage".

**Verify:** T2's validator against the Codex file and crate, plus:

```bash
cd <worktree>
python3 /tmp/check-surface.py docs/adapters/codex/CONSUMED-SURFACE.md \
  packages/core-rs/crates/mainframe-adapter-codex     # OK (<n> rows), n ≥ 12
wc -l docs/adapters/codex/CONSUMED-SURFACE.md          # ≤ 300
grep -c 'KNOWN DRIFT' docs/adapters/codex/CONSUMED-SURFACE.md   # ≥ 1
grep -q 'thread/tokenUsage/updated' docs/adapters/codex/CONSUMED-SURFACE.md
```

## T5 — State record and artifact hygiene

**Creates:** `.claude/skills/changelog-watch/state.json`
**Edits:** `.gitignore`
**Parallel with:** T1.

```json
{
  "version": 1,
  "tools": {
    "claude": {
      "repo": "anthropics/claude-code",
      "mode": "changelog",
      "changelogPath": "CHANGELOG.md",
      "tagPrefix": "v",
      "lastReviewedVersion": "2.1.206",
      "lastReviewedAt": "2026-07-25",
      "checklist": "docs/adapters/claude/CONSUMED-SURFACE.md"
    },
    "codex": {
      "repo": "openai/codex",
      "mode": "releases",
      "includePrerelease": false,
      "tagPrefix": "rust-v",
      "lastReviewedVersion": "rust-v0.144.3",
      "lastReviewedAt": "2026-07-25",
      "checklist": "docs/adapters/codex/CONSUMED-SURFACE.md"
    }
  }
}
```

`lastReviewedVersion` means "entries up to and including this version have been triaged". It advances
only after a report exists (T8's `--commit-state`), never at fetch time, so a crashed run cannot
silently skip releases. Adding Gemini or OpenCode later means adding a `tools` entry plus a checklist
file — no code change, provided the repo publishes either a changelog or GitHub releases. Do not add
their entries now.

`.gitignore`: append below the existing `.claude/codex-review/` block (line ~58):

```
# changelog-watch run artifacts (fetched deltas + reports are triage input, not history)
.claude/skills/changelog-watch/reports/
```

**Verify:**

```bash
pnpm exec prettier --check .claude/skills/changelog-watch/state.json
node -e "const s=require('./.claude/skills/changelog-watch/state.json');
  if (s.tools.claude.lastReviewedVersion!=='2.1.206') throw new Error('claude anchor');
  if (s.tools.codex.tagPrefix!=='rust-v') throw new Error('codex tagPrefix');"
git check-ignore .claude/skills/changelog-watch/reports/x.md   # exits 0
```

## T6 — Delta module tests (TDD, red)

**Creates:**

- `.claude/skills/changelog-watch/scripts/changelog-delta.test.mjs`
- `.claude/skills/changelog-watch/scripts/fixtures/claude-changelog.sample.md` — a `# Changelog` H1
  plus four trimmed versions (`2.1.219`, `2.1.218`, `2.1.217`, `2.1.216`), 2–3 bullets each, one of
  them containing a `###` subheading so heading-level handling is pinned.
- `.claude/skills/changelog-watch/scripts/fixtures/codex-releases.sample.json` — six entries with
  `tag_name`, `prerelease`, `published_at`, `body`: three stable, two prerelease with 25-byte bodies,
  and one prerelease deliberately **out of published order** (mirrors fact 5). One stable body
  carries the literal line
  `- [app-server] add thread/tokenUsage/updated v2 event by @celia-oai in #7268`.

**Parallel with:** T5 is a prerequisite only for T8, not for this task.

Tests use hardcoded expectations. Never recompute the implementation's own logic in the assertion,
and never touch the network.

1. `parseChangelogSections` splits on `^## ` only, returns `[{version, body}]` in file order, keeps
   bullet text verbatim, and treats neither the `# Changelog` H1 nor the `###` subheading as a split
   point. Assert exactly `['2.1.219','2.1.218','2.1.217','2.1.216']` and that the `###` line is
   inside its parent body.
2. `sectionsSince(sections, '2.1.217')` → exactly `['2.1.219','2.1.218']`, `reachedAnchor: true`.
   The anchor version itself is excluded.
3. `sectionsSince(sections, '9.9.9')` → `reachedAnchor: false` and an empty entry list. An unknown
   anchor is a signalled condition, never "everything is new".
4. `sectionsSince(sections, '2.1.216', { max: 1 })` → the **oldest** unreviewed version
   (`2.1.217`), `truncated: true`, `nextAnchor: '2.1.217'`. Repeated runs walk forward instead of
   jumping to head.
5. `selectReleasesSince(releases, { lastTag: <stable anchor in the fixture> })` drops prereleases by
   default, returns the newer stable tags, and returns them sorted by `published_at` descending —
   assert the out-of-order fixture entry lands in date position, not API position (fact 5).
6. `selectReleasesSince(..., { includePrerelease: true })` keeps prereleases.
7. `selectReleasesSince(..., { lastTag: 'rust-v9.9.9' })` → `reachedAnchor: false`.
8. `selectReleasesSince(..., { max: 1 })` returns the **oldest** unreviewed stable release, not the
   newest, with `truncated: true` and `nextAnchor` set to that tag — the same forward-walk semantics
   test 4 pins for `sectionsSince`. Assert against a hardcoded tag from the fixture. T12's replay
   depends on exactly this (`--since rust-v0.63.0 --max 1` must yield `rust-v0.64.0`); without this
   test the replay can silently select a different release with a green suite.
9. `renderDelta('codex', entries)` emits each entry's tag as a heading and the **whole** body —
   assert the `#7268` line survives (the raw PR list must never be stripped; fact 6).
10. `nextStateFor(state, 'codex', { version: 'rust-v0.65.0', at: '2026-07-25' })` updates only the
    `codex` entry and leaves the `claude` entry deep-equal to the input (extensibility guard).
11. `tagForVersion` / `versionForTag` round-trip `0.144.3 ↔ rust-v0.144.3` and `2.1.219 ↔ v2.1.219`.

**Verify:**

```bash
node --test .claude/skills/changelog-watch/scripts/   # fails: cannot resolve changelog-delta.mjs
pnpm exec prettier --check '.claude/skills/changelog-watch/scripts/**/*.{mjs,json}'
```

The first command must fail with a module-resolution error — that is the red state. Any other
failure means the fixtures are wrong.

## T7 — Delta module (green)

**Creates:** `.claude/skills/changelog-watch/scripts/changelog-delta.mjs` (≤300 lines, every function
≤50 lines)
**Depends on:** T6.

Pure functions, zero I/O, zero `console.*`. Exports exactly: `parseChangelogSections`,
`sectionsSince`, `selectReleasesSince`, `renderDelta`, `nextStateFor`, `tagForVersion`,
`versionForTag`. Anchoring is **positional, not semver-comparative** — the changelog's own order is
authoritative for Claude, and `selectReleasesSince` sorts by `published_at` before slicing. Errors
surface as returned status fields (`reachedAnchor`, `truncated`) or thrown `Error`s; never as a
printed warning.

**Verify:**

```bash
node --test .claude/skills/changelog-watch/scripts/    # all 11 tests green
wc -l .claude/skills/changelog-watch/scripts/changelog-delta.mjs    # ≤ 300
pnpm exec prettier --check '.claude/skills/changelog-watch/scripts/**/*.mjs'
```

## T8 — Fetch CLI

**Creates:** `.claude/skills/changelog-watch/scripts/fetch-delta.mjs` (≤300 lines)
**Depends on:** T5, T7.

A thin I/O shell over T7. The only file that prints.

- Flags: `--tool <claude|codex>` (required), `--since <version>` (default: state),
  `--max <n>` (default 40), `--out <path>` (default
  `reports/<ISO-date>-<tool>-delta.md`), `--commit-state <version>`, `--json`.
- `--json` replaces the human summary on stdout with one JSON object:
  `{ tool, anchor, head, count, reachedAnchor, truncated, nextAnchor, out }`, where `head` is the
  newest upstream version seen this fetch. It exists so callers can pin the current head without
  scraping prose — the T8 and T13 verifications use it, and SKILL.md step 2 mentions it as the way to
  answer "what is upstream at right now" without writing a delta.
- Fetch, `changelog` mode: `execFile('gh', ['api', 'repos/<repo>/contents/<path>', '--jq', '.content'])`
  base64-decoded, falling back to `fetch('https://raw.githubusercontent.com/<repo>/HEAD/<path>')`
  when `gh` is missing. `releases` mode:
  `execFile('gh', ['api', 'repos/<repo>/releases', '--paginate', ...])`. **Array args only.**
- `--commit-state` rewrites `state.json` via `nextStateFor`, 2-space indented with a trailing
  newline so it stays Prettier-clean. Without the flag the CLI never writes state.
- Exit codes: non-zero with a one-line reason when the anchor is unknown (`reachedAnchor: false`),
  when `gh` is absent and the fallback also fails, or when `--tool` names a tool missing from state.
- Empty delta prints exactly `no changes: <tool> is current at <version>` and exits 0. That literal
  string is the acceptance signal for AC-2 — T11 and T13 both depend on it verbatim.
- On truncation, print `nextAnchor` and the exact command to continue.

**Verify:** (network required)

```bash
cd <worktree>
S=.claude/skills/changelog-watch/state.json; BEFORE=$(shasum "$S")
node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool codex \
  --since rust-v0.63.0 --max 1 --out /tmp/codex-delta.md
grep -q '7268' /tmp/codex-delta.md                     # raw PR list preserved
node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool claude --max 2 --out /tmp/cc.md
grep -c '^## ' /tmp/cc.md                              # 2
# derive upstream HEAD instead of hardcoding it — Claude ships ~1 release/day (fact 12),
# so any literal version here fails on a correct implementation within days
HEAD_V=$(node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool claude --max 1 \
  --json --out /tmp/head.md | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).head")
node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool claude --since "$HEAD_V" \
  | grep -q "no changes: claude is current at $HEAD_V"
node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool claude --since 9.9.9; echo $?   # non-zero
[ "$BEFORE" = "$(shasum "$S")" ]                       # nothing written without --commit-state
```

## T9 — Keep the helper tests alive in CI

**Edits:** `.github/workflows/ci.yml`
**Depends on:** T7.

Add one step to the existing `typecheck` job, immediately after the `setup-workspace` action and
before `Build workspace dependencies` (it needs neither the build nor any package):

```yaml
      - name: Skill helper tests
        run: node --test .claude/skills/changelog-watch/scripts/
```

Rationale for the comment-free change: the step name says what it does; D9 explains why. No new job,
no matrix entry, no extra checkout — the marginal CI cost is under a second.

**Verify:**

System `python3` here has no PyYAML, so check the file textually and let CI parse it:

```bash
cd <worktree>
grep -n -A1 'name: Skill helper tests' .github/workflows/ci.yml   # shows the run: line
awk '/^  typecheck:/{f=1} /^  [a-z-]+:$/&&!/^  typecheck:/{f=0} f&&/Skill helper tests/{found=1}
     END{exit !found}' .github/workflows/ci.yml                   # step is inside the typecheck job
node --test .claude/skills/changelog-watch/scripts/               # the exact command CI will run
```

## T10 — Classification reference

**Creates:** `.claude/skills/changelog-watch/classification.md` (≤200 lines)
**Depends on:** T3, T4, T8.

The judgement half of the skill, kept out of `SKILL.md` so the run steps stay legible.

- **Relevance filter, applied first, drop-by-default.** An entry is relevant only if it touches a
  checklist row's surface: headless/`--print`/stream-json, app-server or JSON-RPC, session or rollout
  files, approvals and permissions, a CLI flag Mainframe passes, model catalogs, context/token
  accounting, or a capability Mainframe could surface. TUI-only, Windows-only, IDE-extension, and
  telemetry entries are dropped without listing. Name the drop rule so two runs over the same range
  agree.
- **Risk vs opportunity.** Risk = an existing checklist row's assumption may no longer hold (renamed,
  added or removed field; changed default; deprecated method; a new event replacing one Mainframe
  parses). Opportunity = a new upstream capability with no row yet, including anything in the Codex
  explicitly-ignored notification set.
- **Severity.** `high` = silent data loss or a parse that fails closed (the `tokenUsage` precedent);
  `medium` = degraded rendering; `low` = cosmetic.
- **Routing table**, keyword → checklist ID prefix: `stream-json|--print|headless` → `CLAUDE-EVT-*` /
  `CLAUDE-FLAG-*`; `control request|permission|hook` → `CLAUDE-CTRL-*`; `app-server` →
  `CODEX-RPC-*` / `CODEX-EVT-*`; `rollout|session file|resume|fork` → `*-FILE-*`;
  `token usage|context window` → the Codex `thread/tokenUsage/updated` row and `CLAUDE-CTRL-02`;
  `usage|rate limit|/usage|weekly limit` → `CLAUDE-PROBE-03`; `model|deprecat` → `CLAUDE-PROBE-02`.
  State plainly that the table is a starting point and the checklist files are authoritative.
- **Two worked examples**, so the bar is concrete rather than described: the Claude CLI 2.1.118+ move
  of the subagent link to `toolUseResult.agentId` (`CLAUDE-FILE-*`, medium, subagent messages
  orphaned) and a Codex rollout-storage example — a `~/.codex/state_5.sqlite` schema-version bump
  (`CODEX-FILE-*`, high, external Codex sessions vanish from the sidebar).
- **The `thread/tokenUsage/updated` change is deliberately absent from this file.** It is the entry
  T12 replays, and a classifier that only recalls its own reference doc would pass the sole regression
  gate while being useless on everything else. Keep the worked examples off the replay target so T12
  tests generalization. Anyone editing `classification.md` must preserve this — say so in the file.
- **Report template** with a fixed skeleton: run header (tool, version range, entries seen, entries
  dropped); then per risk — entry text and upstream reference, checklist ID and its consumer
  `file::symbol`, why the entry threatens that row, the recommended regression test (extend the row's
  Coverage test, or add one and name the file), and a verification pointer to the matching
  protocol-debugger skill; then adoption opportunities (capability, where it would land, rough size);
  then a `## No relevant changes` note when a tool's delta survives the filter empty.
- **What counts as a recommended regression test.** It must name a Rust unit or integration test file
  in `packages/core-rs/crates/mainframe-adapter-{claude,codex}/` (extend the row's existing Coverage
  test, or state the new `#[test]` fn and its file). Playwright specs and
  `packages/e2e/fixtures/recordings/` are explicitly **not** acceptable: they replay Mainframe's own
  adapter API, so they keep passing after an upstream wire-shape break — exactly the failure mode the
  `tokenUsage` precedent demonstrates. Prefer a test that asserts the deserialized value, not just
  that parsing returned `Ok`, since the `tokenUsage` regression sat inside an `if let Ok(..)`.
- **Todo draft template** for T14, matching `docs/agents/issue-tracker.md` and
  `docs/agents/triage-labels.md` (`labels: ["needs-triage"]`, `status` left at its default `open`),
  one draft per risk.

**Verify:** every checklist ID prefix named in the routing table exists in the checklists.

```bash
cd <worktree>
grep -oE '(CLAUDE|CODEX)-[A-Z]+' .claude/skills/changelog-watch/classification.md | sort -u \
  | while read -r id; do grep -qh "$id" docs/adapters/*/CONSUMED-SURFACE.md || echo "UNKNOWN $id"; done
wc -l .claude/skills/changelog-watch/classification.md   # ≤ 200
```

Prints nothing but the line count.

## T11 — SKILL.md

**Creates:** `.claude/skills/changelog-watch/SKILL.md` (≤150 lines)
**Depends on:** T10.

Frontmatter matches the sibling skills: `name: changelog-watch` and a `description` naming the
distinct triggers (checking whether new Claude Code or Codex releases affect Mainframe's adapters;
auditing adapter drift after a CLI upgrade). No `disable-model-invocation` (D10).

Ordered steps, each with a checkable completion criterion:

1. Read `state.json`; pick the tool(s) to run.
2. Run `fetch-delta.mjs` per tool (exact commands inline). Done when a delta file exists, or the CLI
   printed `no changes: <tool> is current at <version>` — in which case stop here and report that.
   Note `--json` here as the way to read the current upstream head and the truncation fields without
   parsing the human output.
3. Load the tool's `CONSUMED-SURFACE.md`. Done when every checklist ID is in context.
4. Classify every delta entry per `classification.md`. Done when **every** entry is either mapped to
   a checklist ID or explicitly dropped, and the dropped count is reported. An unclassified entry
   means the step is not finished.
5. Write the report to `reports/<ISO-date>-<tool>-report.md` and print the summary.
6. Advance state with `--commit-state` **only after** the report exists; commit `state.json`.
7. Offer the todo drafts for filing per `docs/agents/issue-tracker.md`. Filing is a separate,
   explicit action — never automatic.

Also include: a "range too wide" note (use `--max`, walk forward via `nextAnchor`, commit state each
pass); an "adding a tool" note (a `state.json` entry plus a checklist file, no code change); and
pointers to `.claude/skills/{claude,codex}-protocol-debugger/` for verifying a suspected change
against the live CLI (D3).

**Verify:**

```bash
cd <worktree>
wc -l .claude/skills/changelog-watch/SKILL.md            # ≤ 150
head -4 .claude/skills/changelog-watch/SKILL.md          # --- / name / description / ---
grep -oE '(docs|\.claude)/[A-Za-z0-9_./-]+\.(md|mjs|json)' .claude/skills/changelog-watch/SKILL.md \
  | sort -u | while read -r f; do test -e "$f" || echo "MISSING $f"; done
```

The last command prints nothing.

## T12 — Validation replay (AC-3)

**Creates:** `.claude/skills/changelog-watch/VALIDATION.md` (≤120 lines)
**Depends on:** T11.

Run the skill over the historical Codex range that contains the `tokenUsage` change, without
touching `state.json`:

```bash
node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool codex \
  --since rust-v0.63.0 --max 1 --out /tmp/replay-codex.md
```

Then classify `/tmp/replay-codex.md` with `classification.md` against
`docs/adapters/codex/CONSUMED-SURFACE.md`.

**Pass condition — must be met, not merely recorded.** The report flags
`[app-server] add thread/tokenUsage/updated v2 event … #7268` as a **compatibility risk**, maps it to
the Codex `thread/tokenUsage/updated` checklist row, names
`packages/core-rs/crates/mainframe-adapter-codex/src/types.rs::TokenUsageUpdatedParams` as the
affected consumer, and recommends a regression test extending
`packages/core-rs/crates/mainframe-adapter-codex/tests/event_mapper.rs`.

If the replay fails, fix `classification.md` (relevance filter or routing) or the T4 row — never the
report — and rerun. `VALIDATION.md` records the command, the pass condition, the actual verdict, and
the date.

**Verify:**

```bash
cd <worktree>
S=.claude/skills/changelog-watch/state.json; BEFORE=$(shasum "$S")
grep -q '7268' /tmp/replay-codex.md   # the fetched delta really contained the entry
grep -q '7268' .claude/skills/changelog-watch/VALIDATION.md
grep -q 'Verdict: PASS' .claude/skills/changelog-watch/VALIDATION.md   # not merely "Verdict:"
grep -q 'TokenUsageUpdatedParams' .claude/skills/changelog-watch/VALIDATION.md
[ "$BEFORE" = "$(shasum "$S")" ]      # replay left state untouched
```

A recorded `Verdict: FAIL` fails this task — the replay is the gate, not a diary entry.

## T13 — First live run (AC-1 and AC-2)

**Depends on:** T12. **Produces:** gitignored artifacts plus a `state.json` commit.

1. Run both tools from the seeded anchors (Claude `2.1.206`, Codex `rust-v0.144.3`). Claude's window
   is ~13 versions of a dense changelog: walk it in passes of `--max 5`, committing state after each
   pass, rather than classifying it all at once. Codex's window is four stable releases.
2. Confirm on the resulting reports (AC-1): compatibility risks and adoption opportunities are
   separated; every risk names a checklist ID, its Rust consumer, and a recommended regression test;
   irrelevant entries appear only as a dropped count.
3. `--commit-state` both tools to head, then rerun both **immediately**. Both must print
   `no changes: <tool> is current at <version>` (AC-2). Record both versions in the commit message.
   Claude ships roughly a release a day (fact 12), so a rerun a day later legitimately shows a delta —
   if classification spans days, redo the final `--commit-state` and rerun back to back before
   committing.

**Verify:**

```bash
cd <worktree>
node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool claude | grep -q 'no changes'
node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool codex  | grep -q 'no changes'
git status --short        # state.json modified; no report files (they are ignored)
```

## T14 — File findings as todos (skippable)

**Depends on:** T13. **Touches no repo files.**

For each compatibility risk in the T13 reports, create one todo per `docs/agents/issue-tracker.md`:
resolve `project_id` from `~/.mainframe/mainframe.db`, compute the next `number`, generate a 21-char
nanoid `id`, insert with `labels = ["needs-triage"]` and the default `open` status. Title names the
surface; body carries the entry text, the checklist ID, the affected consumer, and the recommended
regression test. The Codex `tokenUsage` drift (fact 7) is expected to be one of them, and its body
should ask for confirmation with `.claude/skills/codex-protocol-debugger/` before any fix, since the
runtime impact is inferred from the serde contract rather than observed.

File two more todos for the pre-existing defects the checklist work surfaces, so they do not die in a
doc cell (both are drift the checklist can only record, not resolve):

- `CLAUDE-FILE-07` — three divergent cwd encoders (`transcript.rs::encode_project_path`,
  `external_session_paths.rs::encode_path`, `mainframe-background-tasks/src/encoding.rs::encode_cwd_segment`).
  At most one matches the CLI; ask for a single shared encoder with a test per call site.
- `CLAUDE-FILE-08` — `spool_root.rs::current_uid()` is a `TODO(port)` stub returning `None`, so the
  production spool root resolves to `/tmp/claude-0` on any non-root daemon. Needs `libc`/`rustix` on
  the workspace allowlist.

Fix nothing — the brief puts fixes out of scope. This task is isolated so it can be dropped whole if
the tracker should not be written from this branch.

**Verify:**

```bash
sqlite3 -json ~/.mainframe/plugins/todos/data.db \
  "SELECT number,title,labels FROM todos WHERE project_id='<id>' ORDER BY number DESC LIMIT 5;"
```

Lists the new rows, each with `needs-triage`.

## T15 — Repo docs wiring

**Edits:** `CLAUDE.md`, `AGENTS.md`. Independent of every other task.

1. Add a Skills-table row: trigger "Checking whether new Claude Code / Codex releases affect
   Mainframe's adapters" → `changelog-watch`. Mirror it in `AGENTS.md`.
2. Replace the dead protocol-doc link list (`CLAUDE.md:23`, `AGENTS.md:9`) with the docs that exist:
   `docs/adapters/claude/CLEAR.md`, both new `CONSUMED-SURFACE.md` files, and
   `.claude/skills/{claude,codex}-protocol-debugger/`. Keep the `claude-source-researcher` sentence.
   Required by D4 — the checklist ecosystem must not ship next to seven dead links, and `CLEAR.md`
   already notes the docs are missing.

Scope: these two files only. The repo has other stale references — `.agents/test-worktree.md:175`,
the `packages/core/src/plugins/builtin/{claude,codex}/…` paths inside both protocol-debugger skills
(orphaned by the Rust cutover), and intra-skill links to `PREBUILT_PROMPTS_CATALOG.md` / `QUEUE.md` —
and fixing them here would turn a skill branch into a docs sweep. Leave them; the D4 obligation is
limited to the two entry-point docs this skill's row lives in.

**Verify:**

```bash
cd <worktree>
grep -oE '\(docs/[A-Za-z0-9_./-]+\.md\)' CLAUDE.md AGENTS.md | sed 's/^[^:]*://' | tr -d '()' \
  | sort -u | while read -r f; do test -e "$f" || echo "MISSING $f"; done
grep -c 'changelog-watch' CLAUDE.md AGENTS.md    # 1 each
```

The first prints nothing.

## T16 — Changeset and final gate

**Creates:** `.changeset/<generated-name>.md`
**Depends on:** every other task.

Run `pnpm changeset --empty`. This branch ships no package code — a skill, two docs, a state file,
and a Node helper that lives outside every workspace package — so no version bump is warranted; the
hook and CI only require that a changeset exists.

**Verify:**

```bash
cd <worktree>
node --test .claude/skills/changelog-watch/scripts/
pnpm exec prettier --check '.claude/skills/changelog-watch/**/*.{mjs,json}'
wc -l docs/adapters/README.md docs/adapters/*/CONSUMED-SURFACE.md \
      .claude/skills/changelog-watch/*.md .claude/skills/changelog-watch/scripts/*.mjs   # all ≤300
pnpm changeset status --since=origin/main
git status --short          # only intended files; no report artifacts
```

## Acceptance-criteria traceability

| Brief criterion | Satisfied by |
|---|---|
| Report separates compatibility risks (each naming the affected surface and a recommended regression test) from adoption opportunities; irrelevant entries omitted | T10 (drop rule + report template), T11 step 4 (exhaustive criterion), T13 step 2 |
| Records last-checked versions per tool; a rerun with no new releases reports "no changes" | T5 (state), T8 (`--commit-state`, literal `no changes:` line), T13 step 3 |
| Validation replay over the historical Codex `tokenUsage` range flags it as a compatibility risk | T12 (pinned `rust-v0.63.0` → `rust-v0.64.0`, PR #7268, hard pass condition), kept non-circular by T10 (the replayed entry is deliberately not a worked example) and T6 test 8 (release truncation returns `rust-v0.64.0`, not some other release) |
| The consumed-surface checklist exists and drives the risk mapping | T1–T4 (checklists), T10 (routing keyed to IDs), T11 step 3, T12 (mapping asserted) |
| Out of scope: fixing drift, scheduling, other tools | No fix tasks (T14 files todos only); no automation wiring; T5's schema is multi-tool but only two fetch modes ship |

## Risks and open items

1. **Classification is model-driven**, so unit tests cannot cover it. The pinned replay (T12) is the
   only regression gate — rerun it after any edit to `classification.md` or the Codex checklist.
2. **`gh` is required** for the Codex releases API (and for the Claude path when
   `raw.githubusercontent.com` is unreachable). T8 fails loudly rather than reporting an empty delta,
   which would otherwise read as "no changes" and advance the anchor over unreviewed releases.
3. **Codex release-body format has drifted before** (`* … by @user in #NNNN` vs `- #NNNNN title
   @author`). The extractor deliberately does not parse PR lines — bodies pass through whole — so
   format changes cannot break it.
4. **Claude's changelog carries no dates.** Version order is the only anchor. If Anthropic ever
   reorders or rewrites history, `reachedAnchor: false` surfaces it instead of silently skipping.
5. **A wide Claude window is expensive.** Thirteen versions is roughly 130 bullets; the `--max` walk
   keeps each pass reviewable, but the first run is still the largest one this skill will ever do.
6. **Known drift found while planning** (fact 7) is recorded, not fixed. If T14 is skipped, that
   finding leaves the branch only in the checklist's `KNOWN DRIFT` note — along with the two
   `CLAUDE-FILE-07/08` defects.
7. **The Coverage column will be thin, honestly.** Several surfaces (stderr trust matching, the prose
   parsers, the spool paths) have no test that would fail on an upstream rename, and the e2e suite
   cannot stand in — it exercises Mainframe's adapter API, not the CLI wire. Empty Coverage cells are
   the point: they mark where a recommended regression test has to be written from scratch rather than
   extended. The T3 `awk` check forces every cell to say something, even if that something is `none`.
8. **T15 edits repo-wide docs** (`CLAUDE.md`, `AGENTS.md`) beyond the strict scope of the todo. It is
   included because D4 makes shipping the checklist next to seven dead links indefensible; drop it if
   the reviewer disagrees, at the cost of leaving those links dead.
