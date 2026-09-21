# Todo #356 — one shared Web tool card for Claude and Codex

## Goal

A web search or web fetch performed by a Codex session must render in the same `WebFetchCard` that
Claude's `WebFetch`/`WebSearch` render in — same globe, same verb, same clickable URL, same status
and error treatment — instead of the generic JSON fallback. No new card component, no visual
redesign. Two edits get there: the Codex adapter normalizes its web tool call to the canonical
`WebFetch`/`WebSearch` name on **both** the live and history-reload paths, and the card derives its
verb and target from the *arguments* rather than from a Claude-specific tool name, so it reads
either family's argument shape and degrades to a header-only card when neither is present.

## What the capture actually says (corrects the brief)

The brief guessed the Codex spelling as `web__search` / `web__fetch`. The real captured spelling is
**one** tool: namespace `web`, tool `run` (`web__run`), covering search *and* fetch, with the
ChatGPT `web.run` argument shape — `search_query: [{q}]`, `open: [{ref_id, lineno}]`,
`find: [{ref_id, pattern}]`, not `{url}` / `{query}`. Receipts in **Established facts**. The
consequence: the adapter picks the canonical name from which command key is present, and the card
must read `search_query[0].q` and `open[0].ref_id` in addition to Claude's `query` / `url`.
Anything else in the brief that names `web__search`, `web__fetch` or a bare `fetch` describes a
spelling nobody has captured — treat it as out of scope (the brief's own rule).

## Files touched

| File | Change |
| --- | --- |
| `packages/core-rs/crates/mainframe-adapter-codex/src/dynamic_web_tool.rs` | **new**, small: `canonical_web_name(&DynamicToolCallItem) -> Option<&'static str>` (namespace `web` + tool `run`; `open`/`find`/`click` → `"WebFetch"`, else `search_query` → `"WebSearch"`) and `content_items_text(&DynamicToolCallItem) -> String` (concatenate `InputText` texts). |
| `packages/core-rs/crates/mainframe-adapter-codex/src/lib.rs` | declare the module (`pub(crate)`). |
| `packages/core-rs/crates/mainframe-adapter-codex/src/thread_item_render.rs` | `dynamic_tool_call_name` consults `canonical_web_name` first, falls through to today's `<ns>__<tool>` rule; `render_dynamic_tool_call` also emits a `tool_result` for a normalized web call (content = `content_items_text`, `is_error = success == Some(false)`, result id `{id}:result`, mirroring `web_search_render.rs`). Keep the file under the 300-line ceiling — it is at 194. |
| `packages/core-rs/crates/mainframe-adapter-codex/src/history_convert.rs` | the `DynamicToolCall` reload arm emits the same tool-result message when `canonical_web_name` matches, so live and reload stay byte-identical. |
| `packages/core-rs/crates/mainframe-adapter-codex/tests/event_mapper.rs`, `tests/live_vs_history_id_parity.rs` | new cases (see gates). Existing cases stay as they are — their fixture is `web`/`search`, which does **not** normalize under the confirmed rule. |
| `packages/ui/src/features/chat/tools/cards/WebFetchCard.tsx` | target/verb derived from args; degraded header-only state. |
| `packages/ui/src/features/chat/tools/cards/__tests__/WebFetchCard.test.tsx` | new cases appended; **no existing case may be edited** (acceptance criterion). |
| `docs/research/adapters/codex/CONSUMED-SURFACE.md` | one row: the `web`/`run` dynamic tool call and its `web.run` argument keys are now consumed surface, with the breakage note (a renamed upstream command key silently degrades the card to header-only). |
| `.changeset/*.md` | patch changeset. |

`packages/ui/src/features/chat/tools/registry.ts` and `register-cards.ts` are **not** touched — the
adapter puts a registry key on the wire.

## Card derivation rule (the whole UI change)

```
url   = args.url (string)            ?? first http(s) args.open[].ref_id
query = args.query (string)          ?? args.search_query[0].q
url present   -> verb "Fetch",  URL row + summary body   (unchanged for Claude WebFetch)
else query    -> verb "Search", quoted query, no URL row (unchanged for Claude WebSearch)
else          -> degraded: globe + verb + muted "no target" (text-muted-foreground),
                 status dot, trigger disabled, no body, never raw JSON
```

`open[].ref_id` is documented as "Reference id or URL" — only an `http`/`https` value is a clickable
URL; an internal ref like `turn0search0` is not, and falls through to query, then to degraded. The
degraded verb falls back to `toolName === 'WebSearch' ? 'Search' : 'Fetch'` (my call; the brief does
not say). Existing `data-testid`s are unchanged; the degraded label gets one new id.

## Established facts

- Codex 0.153.4 emits its web tool as `function_call` `{"name":"run","namespace":"web"}` with
  arguments `{"search_query":[{"q":…}],"response_length":"long"}` — captured, not synthetic:
  `~/.codex/sessions/2026/07/22/rollout-2026-07-22T14-20-25-019f898e-33a8-7b00-90ee-a67a362fd1e5.jsonl`
  lines 588 and 895. These are the only two non-`mcp__` namespaced calls in the entire local rollout
  corpus (`grep -rhoE '"namespace":"[^"]*"' ~/.codex/sessions | sort | uniq -c`: `collaboration` 286,
  `mcp__*` 41, `clock` 13, `web` 2).
- The `web.run` argument schema is `SearchCommands` with 11 fields —
  `search_query, image_query, open, click, find, screenshot, finance, weather, sports, time,
  response_length`; `OpenOperation` is `{ref_id, lineno}` with `ref_id` documented "Reference id or
  URL to open.", `FindOperation` is `{ref_id, pattern}`, `SearchQuery` is `{q, recency, domains}`.
  Receipt: `strings -a /opt/homebrew/Caskroom/codex/0.153.4/bin/codex`, the
  `codex_api::search::SearchCommands` region (strings lines 442040, 442044, 479809, 479819).
- `web__search` in `tests/event_mapper.rs:489` and `tests/live_vs_history_id_parity.rs:136` is a
  **synthetic** fixture — the file says so at `live_vs_history_id_parity.rs:131` ("no fixture in this
  crate's captures contains one"). It is not evidence of a Codex spelling.
- `dynamic_tool_call_name` / `dynamic_tool_call_input` at
  `thread_item_render.rs:88` / `:95` are already `pub(crate)` and already shared with the reload path
  (`history_convert.rs:17` imports both, used at `:163`). Normalizing inside them satisfies the
  "both paths" acceptance criterion in one place.
- A dynamic tool call emits a tool_use block and **no tool result** on either path today
  (`thread_item_render.rs:105-112`; `history_convert.rs:162-171`, whose comment states the live path
  "renders exactly this one tool_use block, no result"). Without adding one, a Codex web card can
  never leave the in-flight state or show an error body — this is why the result emit is in scope.
- `DynamicToolCallItem` carries `content_items: Option<Vec<DynamicToolCallContentItem>>` and
  `success: Option<bool>` (`thread_item_variants.rs:228-241`); the content item is
  `InputText { text } | InputImage { image_url }` (`:221-224`). That is the result payload.
- The `webSearch` thread item is a *different*, older hosted-tool path: `WebSearchItem` is `{id,
  query}` only (`thread_item_variants.rs:110`), rendered as an already-complete `WebSearch`
  tool_use/tool_result pair by `web_search_render.rs:15` and `web_search_history.rs:16`. Older
  rollouts show that hosted tool's raw form carrying `action: {"type":"open_page","url":…}` as well
  as `{"type":"search","query":…}` (`~/.codex/sessions/.../rollout-…019f898e….jsonl`, the
  `web_search_call` entries dated 2026-06-13). Our `WebSearchItem` has no `action` field, so an
  `open_page` variant of *that* item cannot be routed today — untouched by this pass, see risks.
- The external-session rollout reader reconstructs only `exec_command` and `mcp__*` function calls;
  a `web`/`run` call is silently ignored there (`rollout_reconstruct.rs::handle_function_call`,
  lines 77-105). Out of scope — that path renders no tool call at all, fallback or otherwise.
- `resolveToolCard` needs no change: it is an exact-name lookup plus an `mcp__` prefix rule
  (`packages/ui/src/features/chat/tools/registry.ts:24-30`), and both `WebFetch` and `WebSearch`
  already map to `WebFetchCard` (`register-cards.ts:43-44`).
- `docs/plans/` is gitignored (`.gitignore:53`) — the plan is committed with `git add -f`.

## Risks

- **Codex may rename or re-shape `web.run`.** The mapping keys on `namespace == "web" && tool ==
  "run"`; an upstream rename returns the fallback card, not a crash. The CONSUMED-SURFACE row records
  this.
- **A single `web.run` call can mix commands** (the binary's own example combines `search_query`,
  `finance` and `find`). The precedence rule above picks one verb deterministically; a mixed call
  shows the fetch face. Accepted.
- **`content_items` is unverified against a live web call** — no local capture contains a
  `dynamicToolCall` item with content items. The result emit must tolerate `None`/empty by emitting
  nothing, so the worst case is today's behavior (no result), never a panic or an empty grey body.
- **Only the `web`-normalized dynamic calls gain a tool result**, which is an asymmetry inside
  `render_dynamic_tool_call`. Generalizing it to every dynamic tool call is a separate change with a
  wider blast radius (every fallback card would start showing results) — deliberately not done here.

## Group 1 — shared Web card for Codex (the only implementation group)

One agent, TDD inline: write the failing test and the fix in the same turn, Rust first then UI.

Exit gates — each must be true and observable:

1. The Codex adapter's live path turns a `dynamicToolCall` with `namespace: "web"`, `tool: "run"`,
   `arguments: {"search_query":[{"q":…}]}` into a tool_use block named `WebSearch`, and the same item
   with `{"open":[{"ref_id":"https://…"}]}` into one named `WebFetch`. Asserted in
   `tests/event_mapper.rs`.
2. The history-reload path produces the identical tool_use id **and** name for both of those items —
   a new case in `tests/live_vs_history_id_parity.rs`, following
   `dynamic_tool_call_reload_matches_the_live_tool_use_id_and_name`'s structure. This is the
   acceptance criterion's "Rust test asserts live and reload emit the identical tool name".
3. A normalized web call with `content_items` emits a matching tool_result (`{id}:result`) on both
   paths, with `is_error` true when `success` is `false`; a call with no content items emits no
   result, so the existing
   `dynamic_tool_call_renders_a_tool_use_block_namespaced_by_the_tool_source` assertion that
   `tool_results()` is empty still holds unmodified.
4. A non-web dynamic tool call still gets `<namespace>__<tool>` — the two existing naming tests pass
   untouched.
5. `WebFetchCard` renders "Fetch" + a clickable URL for Codex `{"open":[{"ref_id":"https://…"}]}`
   args, "Search" + the quoted query for `{"search_query":[{"q":…}]}` args, and the header-only
   degraded card (trigger disabled, no body, no JSON) when neither resolves — new cases in the card's
   test file.
6. Clicking the URL row of a Codex-shaped call calls `useHost().shell.openExternal` with that URL,
   through the same spy the existing tests use.
7. **Every pre-existing case in `WebFetchCard.test.tsx` passes with zero edits to that file's
   existing cases** — the acceptance criterion for "Claude rendering unchanged".
8. The Codex CONSUMED-SURFACE doc has the `web`/`run` row.
9. A patch changeset exists, and the repo's normal validation for both touched packages
   (`mainframe-adapter-codex` tests + clippy/fmt, `packages/ui` unit tests + typecheck + lint) is
   green — typecheck matters here because it covers test files that the build does not.
