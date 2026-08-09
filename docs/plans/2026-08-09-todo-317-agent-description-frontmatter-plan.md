# Agent descriptions from frontmatter — implementation plan

Todo #317 · route `no-spec` · branch `todo/317-agent-description-frontmatter`

## Goal

Every agent in the composer's `@` picker is captioned `---` because the Claude adapter derives an agent's
description from the first non-blank line of the markdown instead of its frontmatter, and that first line is the
opening `---` fence. Fixing the derivation alone is not enough: the shared frontmatter parser is line-based and
cannot read the YAML block scalars (`description: |`) every real agent file uses, and it finds the closing fence
by substring search, so a `---` anywhere inside the block truncates the attributes. This plan rebuilds
`parse_frontmatter` as a single-pass, line-anchored reader that understands `|`/`>` block scalars, makes
`build_frontmatter` round-trip what that reader accepts, adds one derivation that reads the frontmatter
`description` first and keeps the first-line/heading heuristic as the no-frontmatter fallback, and projects the
declared description to a one-line caption in the adapter — so the picker row, the REST contract and the UI stay
exactly as they are.

## Root cause, verified in the code

All three defects are in `packages/core-rs/crates/mainframe-adapter-claude/src/`:

1. `skills.rs:486-493` — `agent_description(raw)` takes the first non-blank line and strips a leading `#`. For a
   real agent file that line is `---`, returned verbatim. `list_agents` (`skills.rs:317`) and `update_agent`
   (`skills.rs:460`) are its only callers. `scan_skills_dir` (`skills.rs:222`) reads
   `attributes["description"]` instead — the two file kinds have two derivations, which is the bug.
2. `frontmatter.rs:40-50` — the parser splits the block on `\n` and takes `key: value` at the first colon. For
   `description: |` the value is `|`; the indented continuation lines are then parsed as further keys and split
   at whatever colon they contain (an `<example>` line like `user: "…"` becomes an attribute).
3. `frontmatter.rs:27` — `content[3..].find("---")` is a substring search, so any `---` in the block (or a
   `---` inside an embedded example) ends the frontmatter early and drops every attribute after it.

Downstream, unchanged by this plan: `routes/agents.rs:70` → `GET /api/adapters/{id}/agents` →
`packages/ui/src/lib/api/agents.ts` → `use-chat-skills.tsx` → `mention-adapter.ts:55-60`, which renders
`a.description` as the picker row's caption.

## Constraints

- Rust only in `packages/core-rs`, plus one additive optional field in `packages/types/src/skill.ts`.
- Max 300 lines per file, 50 per function (root `CLAUDE.md`). `skills.rs` is **604 lines today** — see Decision
  D1; Task 7 decomposes it.
- The daemon REST contract is co-owned by the mobile submodule: additions only, no reshaping.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` all gate CI
  (`.github/workflows/rust-port.yml`).
- A changeset is required before committing.
- Tests must not read the developer's real `~/.claude/agents`: `list_agents` scans the global directory as well
  as the project one, so every fixture uses a `todo317-*` name and asserts on `scope == AgentScope::Project`.

## Decisions

Unilateral calls made while planning. Each is a judgement the reviewer can overturn.

- **D1 — `skills.rs` is decomposed, not merely edited.** The brief's acceptance list says "touched files stay
  under 300 lines". `skills.rs` is 604 lines before this change, so the criterion is only satisfiable by
  splitting it. Task 7 does that mechanically (facade + `skills/scan.rs` + `skills/crud.rs` +
  `skills/agents.rs`), preserving the public paths `skills::list_skills`, `skills::list_agents`,
  `skills::create_agent`, … that `routes/agents.rs` and `routes/skills.rs` call. The crate already uses the
  `foo.rs` + `foo/` layout (`session.rs`, `messages.rs`, `cliproxy.rs`).
- **D2 — clip chomping is treated as strip.** YAML's default (`|`) keeps one trailing newline. A description is
  a display string; a trailing newline is noise that every consumer would have to trim. `|` and `|-` therefore
  both yield a value with no trailing newline; `|+` still preserves them for anyone who asks explicitly. `|-`
  is what `build_frontmatter` emits, so the emitted YAML is also correct under a real YAML reader.
- **D3 — the summary always cuts at the first sentence, not only "if the line is long".** The brief's Q4 answer
  reasons that agent descriptions open with a "Use this agent to…" sentence followed by `Examples:`. The real
  `planner.md` first line is 103 characters, so any "only if long" threshold above 103 keeps the trailing
  ` Examples:` and any threshold below it is arbitrary. Cutting at the first sentence boundary always, with a
  200-character cap as the runaway guard, is the rule that produces the intended caption.
- **D4 — abbreviation guard instead of a minimum-length guard.** A bare "first `.` followed by whitespace" rule
  cuts "e.g. …" after two characters. Rather than a magic minimum sentence length, the boundary scan skips a
  period whose preceding token is one of `e.g. i.e. etc. vs. cf.`.
- **D5 — the round-trip criterion is met through `build_frontmatter`, not `create_agent`.** `create_agent`
  writes `# {name}\n\n{body}` with no frontmatter at all, and the preserved heading test pins exactly that
  (`skills.rs:558-579`). Making it start writing frontmatter would change the file format agents are created in
  — out of scope here. The write/read round-trip is therefore specified and tested on
  `build_frontmatter`/`parse_frontmatter` and on `create_skill`, which is the only caller.
- **D6 — the mock adapter keeps its own copy.** `mainframe-adapter-mock` has a private `frontmatter_attrs`
  (`crates/mainframe-adapter-mock/src/skills.rs:77`) and does not depend on `mainframe-adapter-claude`. It is a
  test double whose fixtures are heading-style, and it is not "the parser shared by skills and agents" the brief
  scopes. It is touched only to add the new struct field (Task 8) so the crate still compiles.
- **D7 — `full_description` is an additive optional field.** `description` keeps carrying the one-line caption,
  so the picker and mobile are fixed without a UI change; the complete declared value rides along in
  `fullDescription?` for a future hover card. Rust gets
  `#[serde(default, skip_serializing_if = "Option::is_none")]`, which keeps the existing
  `agent_config_round_trips` test in `crates/mainframe-types/src/skill.rs` green.
- **D8 — explicit indentation indicators (`|2`, `>4`) are out of scope.** They never appear in agent or skill
  files. A block header the parser does not recognise falls back to today's behaviour: the text after the colon
  is stored as the inline value. This is documented in the parser's module comment.

## Out of scope

The picker's layout and styling (#304); adopting a YAML crate (`packages/core-rs` has no YAML dependency today
and this change does not justify adding one); the Codex adapter (it has no skills/agents listing); skill/agent
creation UI copy; any UI change at all — `mention-adapter.ts` renders `description` and that field now carries
the right text.

---

## Task 1 — RED: frontmatter parser tests

**Files**

- Create: `packages/core-rs/crates/mainframe-adapter-claude/tests/frontmatter_parsing.rs`

**Why an integration test file:** `parse_frontmatter` and `build_frontmatter` are already `pub` and the module is
`pub mod frontmatter` (`lib.rs:26`), so this file compiles against today's code and fails on behaviour — a real
red phase — while sharing no file with the implementation task.

**Steps**

- [ ] Add `#![allow(clippy::unwrap_used, clippy::expect_used)]` and
      `use mainframe_adapter_claude::frontmatter::{build_frontmatter, parse_frontmatter};` (mirrors
      `tests/title_generation.rs`).
- [ ] Write these cases, each asserting on `fm.attributes` / `fm.body`:
  1. `literal_block_scalar_keeps_newlines` — `description: |` with two indented lines →
     `"first line\nsecond line"`; the indentation prefix is stripped; `name` on the line above still parses.
  2. `folded_block_scalar_joins_lines` — `description: >` with two indented lines → `"first line second line"`;
     a blank line inside the block becomes a single `\n`.
  3. `chomping_indicators` — `|-`, `|`, `|+` over the same three-line block: `|-` and `|` yield no trailing
     newline (Decision D2), `|+` preserves the trailing blank line as `\n`.
  4. `block_scalar_swallows_colons` — a block whose indented lines contain `user: "hi"` and `assistant: "yo"`
     produces exactly two attributes (`name`, `description`) — no `user`/`assistant` keys.
  5. `indented_triple_dash_does_not_end_frontmatter` — a `---` line indented inside a block scalar; the block
     keeps it as content and a `tools:` key *after* the block still parses.
  6. `body_triple_dash_is_not_the_closing_fence` — `---\nname: X\n---\n\nintro\n\n---\n\nmore` → attribute `X`,
     body starts at `intro` and still contains the horizontal rule.
  7. `unfenced_leading_dashes_are_not_frontmatter` — the fixture is exactly `----- banner\n\nbody` (pin it;
     with a trailing `\n\n---\n\ntail` the case fails today instead): no attributes and the untouched body. It
     passes today through the missing-closing-fence branch and passes under the new line-anchored rule for the
     right reason — a permanent-green regression guard, not a red test.
  8. `crlf_frontmatter_parses` — the same file with `\r\n` line endings parses identically.
  9. `inline_scalar_unchanged` — `name: PDF` / `description: Work with PDFs` still trim to the same values, and
     `description: Handles a: b` keeps `Handles a: b` (split at the first colon only).
  10. `build_round_trips_multiline_value` — `build_frontmatter(&[("name","x"),("description","line one\nline
      two: with colon")], "# Body")` then `parse_frontmatter` of the result returns the identical description,
      and the body is `# Body`.
  11. `build_round_trips_trailing_newline_value` — a value ending in `\n` survives the same cycle.
  12. `build_round_trips_inline_colon_value` — `"Handles a: b"` survives without becoming a block scalar.
- [ ] Do NOT reference any symbol that does not exist yet (no `full_description`, no
      `derive_agent_description`) — this file must compile today.

**Verify**

```bash
cd packages/core-rs && cargo test -p mainframe-adapter-claude --test frontmatter_parsing
```

Expected: the file compiles and cases 1, 2, 3, 4, 5, 10 and 11 FAIL. Cases 6, 7, 8, 9 and 12 already pass
against today's parser and are green regression guards — case 6 because `content[3..].find("---")` happens to
land on the real closing fence, case 8 because the existing `.trim()` on key and value removes the `\r`, case 7
because `----- banner` has no closing fence at all. They must stay green through Tasks 3-4. Record the failing
list in the commit message.

## Task 2 — Block-scalar reader

**Files**

- Create: `packages/core-rs/crates/mainframe-adapter-claude/src/frontmatter/block_scalar.rs`
- Modify: `packages/core-rs/crates/mainframe-adapter-claude/src/frontmatter.rs` (add `mod block_scalar;` only)

**Interfaces**

```rust
pub(crate) enum Style { Literal, Folded }
pub(crate) enum Chomp { Strip, Keep }          // clip is folded into Strip — Decision D2
pub(crate) struct Header { pub style: Style, pub chomp: Chomp }

/// `Some(header)` when the text after `key:` is exactly `|`, `|-`, `|+`, `>`, `>-` or `>+`.
pub(crate) fn parse_header(value: &str) -> Option<Header>;

/// Consumes the continuation lines of a block scalar starting at `lines[start]`.
/// Returns the folded value and the index of the first line NOT consumed.
pub(crate) fn read_block(lines: &[&str], start: usize, header: &Header) -> (String, usize);
```

**Steps**

- [ ] `parse_header`: match the six accepted headers; anything else → `None` (Decision D8).
- [ ] `read_block`: consume while the line is blank or its indentation is greater than zero (frontmatter keys
      sit at column 0); stop at the first non-blank line with zero indentation, `---` included, without
      consuming it.
- [ ] Take the block indent from the first non-blank consumed line; strip exactly that prefix from every
      consumed line; blank lines become `""`.
- [ ] `Literal`: join content lines with `\n`. `Folded`: split the content lines into paragraphs on blank lines,
      join each paragraph's lines with a single space, join paragraphs with `\n`.
- [ ] Chomping: `Strip` removes all trailing newlines; `Keep` preserves one `\n` per trailing blank line.
- [ ] Keep every function under 50 lines — split the fold step into its own helper if it grows.
- [ ] Add in-file `#[cfg(test)]` unit tests for `parse_header` (all six + three rejections) and for `read_block`
      indent stripping with a mixed-indentation block.

**Verify**

```bash
cd packages/core-rs && cargo test -p mainframe-adapter-claude block_scalar
```

## Task 3 — Line-anchored single-pass `parse_frontmatter`

**Files**

- Modify: `packages/core-rs/crates/mainframe-adapter-claude/src/frontmatter.rs`

**Steps**

- [ ] Replace the substring scan with a single pass over `content.split('\n')`, each line stripped of a trailing
      `\r`.
- [ ] Return `{ attributes: empty, body: content.to_string() }` unchanged when the first line is not exactly
      `---`, or when no later line is exactly `---`. Attributes collected before an unterminated block are
      discarded — an unclosed fence is not frontmatter.
- [ ] For each line before the fence: split at the first `:`; skip when there is no colon or the key trims
      empty; if `block_scalar::parse_header(value)` matches, call `read_block` and jump the cursor past the
      consumed lines; otherwise store the trimmed inline value (today's behaviour).
- [ ] Body = the lines after the fence rejoined with `\n`, then `.trim()` — same as today.
- [ ] Update the module doc comment: what is supported (inline scalars, `|`/`>` with `-`/`+`, line-anchored
      fence, CRLF), what is not (explicit indentation indicators, quoting, nested maps, lists), and that clip is
      treated as strip with the D2 reason.
- [ ] Keep the existing five in-file tests passing as-is; do not delete them.
- [ ] Keep the file under 300 lines and every function under 50 (extract a `parse_attribute_line` helper if
      needed).

**Verify**

```bash
cd packages/core-rs && cargo test -p mainframe-adapter-claude --test frontmatter_parsing
cd packages/core-rs && cargo test -p mainframe-adapter-claude frontmatter
```

Expected: every Task 1 case except 10-12 (build) passes.

## Task 4 — `build_frontmatter` round-trips block scalars

**Files**

- Modify: `packages/core-rs/crates/mainframe-adapter-claude/src/frontmatter.rs`

**Steps**

- [ ] Keep the signature `build_frontmatter(attrs: &[(&str, &str)], body: &str) -> String` and the ordered-slice
      contract (`create_skill` is the only caller).
- [ ] A value with no `\n` is emitted as `key: value`, exactly as today — an interior colon needs no quoting
      because the parser splits at the first colon only.
- [ ] A value containing `\n` is emitted as a block scalar: `key: |-` when it has no trailing newline, `key: |+`
      when it does, followed by each value line indented two spaces (a trailing empty line stays empty).
- [ ] Keep the existing `build_round_trips_ordered_keys` test green (its values are single-line).

**Verify**

```bash
cd packages/core-rs && cargo test -p mainframe-adapter-claude --test frontmatter_parsing
```

Expected: all twelve Task 1 cases pass.

## Task 5 — RED: agent-listing tests

**Files**

- Create: `packages/core-rs/crates/mainframe-adapter-claude/tests/agent_listing.rs`
- Create: `packages/core-rs/crates/mainframe-adapter-claude/src/__fixtures__/agent-block-scalar.md`

**Why:** `skills::list_agents` is already `pub`, so this file compiles today and fails on behaviour. It must not
mention `full_description`, which does not exist yet.

**Steps**

- [ ] Write the fixture as a real-shaped agent file: `name:` inline, `description: |` whose first line is
      `Use this agent to write a spec or an implementation plan from an approved brainstorm/design. Examples:`,
      then a blank line, an `<example>` block containing `user: "…"` / `assistant: "…"` lines and a `---`
      horizontal rule indented inside the block, then `tools: Read, Grep` AFTER the block, then the closing
      fence and a body.
- [ ] Load it with `include_str!("../src/__fixtures__/agent-block-scalar.md")` — the crate's existing fixture
      convention (`quota_parse.rs:308`), path-adjusted for a `tests/` file.
- [ ] Test helper: copy the fixture into `<tempdir>/.claude/agents/todo317-planner.md`, call
      `list_agents(tempdir)`, and find the entry with `scope == AgentScope::Project` and the expected name —
      never by name alone (the global `~/.claude/agents` directory is scanned too).
- [ ] Cases:
  1. `block_scalar_description_becomes_first_sentence` — description is
     `Use this agent to write a spec or an implementation plan from an approved brainstorm/design.` — not
     `---`, not empty, no ` Examples:`, no `<example>` markup, single line (`!description.contains('\n')`).
  2. `attributes_after_a_block_scalar_survive` — the same fixture parsed through `parse_frontmatter` still
     yields `tools`, proving the indented `---` did not truncate the block.
  3. `no_frontmatter_agent_uses_heading_heuristic` — a `# todo317-legacy` heading file still yields
     `todo317-legacy`.
  4. `empty_frontmatter_description_falls_back_to_heuristic` — `description:` with an empty value plus a
     `# todo317-empty` heading in the body yields `todo317-empty`.
  5. `inline_frontmatter_description_used_verbatim` — `description: Reviews auth changes.` yields exactly that.
  6. `update_agent_rederives_description` — write a heading-style agent, then `update_agent` it to
     block-scalar content, and assert the returned `description` is the derived first sentence.
- [ ] Add a seventh case in this same file, `skill_with_block_scalar_description_is_not_empty`: write
      `<tempdir>/.claude/skills/todo317-skill/SKILL.md` with a block-scalar `description`, call
      `skills::list_skills(tempdir)` and assert the skill's `description` is the declared text (the brief's
      "skills share the parser" criterion). It belongs here because it drives the same listing surface.

**Verify**

```bash
cd packages/core-rs && cargo test -p mainframe-adapter-claude --test agent_listing
```

Expected: cases 1, 2, 4, 5, 6 and the skill case FAIL; only case 3 passes. Today's `agent_description`
(`skills.rs:486-493`) never reads frontmatter, so every fenced fixture — case 4 and case 5 included — returns
the opening `---` fence verbatim; case 3 is the only file without a fence. Case 4 goes green only once Task 6
runs the fallback heuristic over `parse_frontmatter(raw).body` rather than the raw file, which is what Task 8's
"every Task 5 case passes" gate depends on.

## Task 6 — `agent_description` module

**Files**

- Create: `packages/core-rs/crates/mainframe-adapter-claude/src/agent_description.rs`
- Modify: `packages/core-rs/crates/mainframe-adapter-claude/src/lib.rs` (add `pub mod agent_description;`)

**Interface**

```rust
pub struct AgentDescription {
    /// One-line caption for the picker row.
    pub summary: String,
    /// The complete declared frontmatter description, when the file declares one.
    pub full: Option<String>,
}

pub fn derive_agent_description(raw: &str) -> AgentDescription;
```

**Steps**

- [ ] Create the module with the struct and a stub `derive_agent_description` returning
      `AgentDescription { summary: String::new(), full: None }`, then write the tests below and watch them fail
      before implementing.
- [ ] `full` = `parse_frontmatter(raw).attributes["description"]` when present and non-empty after trim, else
      `None` (mirrors the `nonempty_attr` semantics `scan_skills_dir` uses).
- [ ] `full` present → `summary = summarize(full)`. `full` absent → `summary = heading_heuristic(fm.body)` —
      today's `agent_description` body moved verbatim (first non-blank line, leading `#`s stripped) but fed the
      **parsed body**, never the raw file. Feeding it `raw` would caption every fenced-but-descriptionless agent
      `---`, which is the bug this todo fixes. Behaviour on a file with no frontmatter is unchanged, because
      Task 3 keeps `body == content` on the no-fence branch — so the preserved
      `create_and_list_agent_derives_description_from_heading` test (`# planner\n\nBody text`) still yields
      `planner`.
- [ ] `summarize(value)`:
  1. first non-empty trimmed line that does not start with `<` (skips `<example>`/`<commentary>` markup); none
     → `""`;
  2. cut at the first `.`, `!` or `?` that is followed by whitespace or end of line, skipping a `.` whose
     preceding token is `e.g.`, `i.e.`, `etc.`, `vs.` or `cf.` (Decision D4); no boundary → the whole line;
  3. if the result exceeds 200 characters, cut at the last whitespace at or before 200 and append `…`.
- [ ] Keep each function under 50 lines; `summarize` splits into `first_caption_line` + `cut_at_sentence` +
      `cap_length`.
- [ ] In-file `#[cfg(test)]` unit tests, all against string literals (no filesystem):
      block-scalar description → first sentence; `Examples:` tail dropped; `<example>` first line skipped;
      abbreviation guard (`Runs e.g. codex or claude. Second sentence.` → cuts after `claude.`);
      no-frontmatter heading → heuristic; frontmatter present but `description` empty → the body's heading
      (`---\nname: x\ndescription:\n---\n\n# todo317-empty\n\nbody` → `todo317-empty`, never `---`);
      description with no sentence terminator → whole first line; a 400-character single sentence → capped at
      ≤201 characters ending in `…`; `full` carries the complete multi-paragraph value including the
      `<example>` block.

**Verify**

```bash
cd packages/core-rs && cargo test -p mainframe-adapter-claude agent_description
```

## Task 7 — Decompose `skills.rs`

**Files**

- Modify: `packages/core-rs/crates/mainframe-adapter-claude/src/skills.rs` (becomes the facade)
- Create: `packages/core-rs/crates/mainframe-adapter-claude/src/skills/scan.rs`
- Create: `packages/core-rs/crates/mainframe-adapter-claude/src/skills/crud.rs`
- Create: `packages/core-rs/crates/mainframe-adapter-claude/src/skills/agents.rs`

**Mechanical move only — no behaviour change in this task.**

- [ ] `skills.rs` keeps: the module doc, `SkillsError` + its `From<io::Error>`, `ADAPTER_ID`,
      `skill_scope_str`, `agent_scope_str`, `agent_to_skill_scope`, `home_dir`, `read_dir_names`,
      `nonempty_attr` (all `pub(crate)`), `mod scan; mod crud; mod agents;` and
      `pub use` re-exports so `skills::list_skills`, `skills::create_skill`, `skills::update_skill`,
      `skills::delete_skill`, `skills::list_agents`, `skills::create_agent`, `skills::update_agent`,
      `skills::delete_agent` keep resolving for `routes/agents.rs` and `routes/skills.rs`.
- [ ] `scan.rs`: `SkillMap`, `list_skills`, `scan_skills_dir`, `scan_commands_dir` + the
      `lists_project_skills_with_frontmatter` test.
- [ ] `crud.rs`: `create_skill`, `update_skill`, `delete_skill` + the `create_then_delete_skill_round_trips`,
      `update_skill_not_found_errors` and `delete_plugin_skill_message_shape` tests.
- [ ] `agents.rs`: `list_agents`, `create_agent`, `update_agent`, `delete_agent` + the
      `create_and_list_agent_derives_description_from_heading` test, **kept as the no-frontmatter case, not
      deleted** (brief acceptance criterion).
- [ ] Delete the old private `agent_description` fn from `skills.rs`; `agents.rs` calls
      `crate::agent_description::derive_agent_description`.
- [ ] Move the trailing `// PORT STATUS:` block to the facade and add a line naming the split.

**Verify**

```bash
cd packages/core-rs && cargo test -p mainframe-adapter-claude
cd packages/core-rs && wc -l crates/mainframe-adapter-claude/src/skills.rs crates/mainframe-adapter-claude/src/skills/*.rs crates/mainframe-adapter-claude/src/frontmatter.rs crates/mainframe-adapter-claude/src/frontmatter/block_scalar.rs crates/mainframe-adapter-claude/src/agent_description.rs
```

Expected: every listed file under 300 lines; the pre-existing tests still pass.

## Task 8 — Wire the derivation and add `fullDescription`

**Files**

- Modify: `packages/core-rs/crates/mainframe-types/src/skill.rs`
- Modify: `packages/types/src/skill.ts`
- Modify: `packages/core-rs/crates/mainframe-adapter-claude/src/skills/agents.rs`
- Modify: `packages/core-rs/crates/mainframe-adapter-mock/src/skills.rs`

**Steps**

- [ ] Rust `AgentConfig`: add
      `#[serde(default, skip_serializing_if = "Option::is_none")] pub full_description: Option<String>` as the
      last field. The existing `agent_config_round_trips` test must stay green unchanged.
- [ ] TS `AgentConfig`: add `fullDescription?: string;` after `description`. No other TS change — the picker
      keeps rendering `description`.
- [ ] `list_agents`: replace the `agent_description(&raw)` call with
      `let derived = derive_agent_description(&raw);` and set `description: derived.summary`,
      `full_description: derived.full`.
- [ ] `update_agent`: same derivation from the new `content`.
- [ ] `create_agent`: `full_description: None` — it writes `# {name}\n\n{body}` with no frontmatter, so nothing
      is declared (Decision D5). Leave the written format alone.
- [ ] Mock adapter: add `full_description: None` to its `AgentConfig` literal. No other change (Decision D6).
- [ ] Add an in-file test in `skills/agents.rs`: listing the block-scalar fixture yields
      `full_description == Some(<complete multi-paragraph value>)` while `description` stays the one-liner.

**Verify**

```bash
cd packages/core-rs && cargo test -p mainframe-adapter-claude --test agent_listing
cd packages/core-rs && cargo test
pnpm --filter @qlan-ro/mainframe-types exec tsc --noEmit
```

Expected: every Task 5 case passes.

## Task 9 — Changeset and full verification

**Files**

- Create: `.changeset/<generated-name>.md`

**Steps**

- [ ] `pnpm changeset` → patch on `@qlan-ro/mainframe-types` (it gains `fullDescription`;
      `@qlan-ro/mainframe-ui` moves with it via the `fixed` group in `.changeset/config.json`). Summary: agent
      descriptions in the `@` picker come from frontmatter instead of rendering `---`.
- [ ] Run the full gate.

**Verify**

```bash
cd packages/core-rs && cargo fmt --check
cd packages/core-rs && cargo clippy --all-targets -- -D warnings
cd packages/core-rs && cargo test
pnpm --filter @qlan-ro/mainframe-types build
pnpm --filter @qlan-ro/mainframe-ui typecheck
```

- [ ] Manual confirmation (optional, needs a dev daemon): `curl "localhost:$DAEMON_PORT/api/adapters/claude/agents?projectPath=$PWD"`
      returns one-line descriptions and no `---`.

## Acceptance criteria mapping

| Brief criterion | Covered by |
|---|---|
| Block-scalar description shows in the picker, not `---` | Task 5 case 1, Task 8 |
| Rendered description is a single line, examples excluded | Task 6 `summarize`, Task 5 case 1 |
| No-frontmatter agent keeps the heading heuristic | Task 5 cases 3-4, Task 7 preserved test |
| Plain inline scalar unchanged | Task 1 case 9, Task 5 case 5 |
| A `---` line in the body keeps every attribute | Task 1 cases 5-6, Task 5 case 2 |
| Literal and folded block scalars fold correctly, indent stripped | Task 1 cases 1-3, Task 2 |
| Write/read round-trip survives colons and newlines | Task 1 cases 10-12, Task 4 |
| Rust tests over fixture files incl. a real-shaped agent | Task 5 fixture |
| The heading-derivation test is preserved | Task 7 |
| `cargo check` + tests pass, files < 300 lines, changeset | Tasks 7 and 9 |

## Task groups

| Group | Kind | Tasks | Files owned | Depends on |
|---|---|---|---|---|
| `frontmatter-red-tests` | test | 1 | `tests/frontmatter_parsing.rs` | — |
| `agent-listing-red-tests` | test | 5 | `tests/agent_listing.rs`, `src/__fixtures__/agent-block-scalar.md` | — |
| `frontmatter-parser` | core | 2, 3, 4 | `src/frontmatter.rs`, `src/frontmatter/block_scalar.rs` | `frontmatter-red-tests` |
| `agent-description-derivation` | core | 6 | `src/agent_description.rs`, `src/lib.rs` | `frontmatter-parser` |
| `agents-listing-wiring` | core | 7, 8, 9 | `src/skills.rs`, `src/skills/*.rs`, `crates/mainframe-types/src/skill.rs`, `packages/types/src/skill.ts`, `crates/mainframe-adapter-mock/src/skills.rs`, `.changeset/*` | `agent-listing-red-tests`, `agent-description-derivation` |

No group shares a file with another, so all are file-parallel-safe; the `depends_on` column is the real
ordering. The two red-test groups deliberately do not depend on the implementation groups — their tests must be
observed failing first.
