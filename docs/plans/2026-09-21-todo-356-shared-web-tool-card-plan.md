# Todo #356 — one shared Web tool card for Claude and Codex

## Goal

A web search or web fetch performed by a Codex session must render in the same `WebFetchCard` that
Claude's `WebFetch`/`WebSearch` render in — same globe, same verb, same clickable URL, same status
and error treatment — instead of a mislabelled or unstyled card. No new card component, no visual
redesign. Two edits get there: the Codex adapter reads the `action` its `webSearch` item already
carries and normalizes each operation to the canonical `WebFetch` / `WebSearch` name on **both** the
live and history-reload paths, and the card derives its verb and target from the *arguments* rather
than from a Claude-specific tool name, degrading to a header-only card when neither is present.

## What the capture actually says (corrects the brief)

The brief assumed Codex's web fetch arrives as a **dynamic tool call** (`web__fetch` / bare `fetch`)
and renders as raw JSON. The evidence says otherwise on both counts:

- The raw Responses-API spelling really is one tool — `function_call {name: "run", namespace: "web"}`
  with `web.run`'s `{search_query:[{q}], open:[{ref_id}], find:[{ref_id,pattern}], …}` arguments.
- But the **app-server item** for it is `webSearch`, not `dynamicToolCall`: codex's `WebSearchItem`
  has 4 fields — `id, query, action, results` — and `WebSearchAction` is an internally-tagged enum
  with `search {query, queries}`, `openPage {url}`, `findInPage {pattern}`, `other`.
- Our `WebSearchItem` models only `{id, query}` (`thread_item_variants.rs:110`) and drops `action`
  on the floor, so a Codex **fetch** today renders the Web card with the wrong verb ("Search") and
  no URL — it is not the raw-JSON fallback the brief described.

So the seam is `WebSearchItem` + its two renderers, **not** `dynamic_tool_call_name`. Receipts in
**Established facts**. The item type is inferred from codex's own struct shape, not from a captured
`item/completed` frame — Gate 0 below closes that gap before any code is written, and the
alternative branch is spelled out so a surprise there is a redirect, not a replan.

## Files touched

| File | Change |
| --- | --- |
| `packages/core-rs/crates/mainframe-adapter-codex/src/thread_item_variants.rs` | `WebSearchItem` gains `action: Option<WebSearchAction>`; `query` becomes `#[serde(default)]` so an action-only item can never be dropped. New `WebSearchAction` enum mirroring codex's tags (`search`, `openPage`, `findInPage`, `other`) with an unknown-variant tolerance consistent with this crate's lenient style. Watch the 300-line ceiling — the file is near it; a new `web_search_action.rs` is fine if it crosses. |
| `packages/core-rs/crates/mainframe-adapter-codex/src/web_search_render.rs` | live path: `openPage` → tool_use named `WebFetch` with input `{url}`; everything else (including a missing/`other` action) keeps today's `WebSearch` + `{query}`. The already-complete empty tool_result pair stays. |
| `packages/core-rs/crates/mainframe-adapter-codex/src/web_search_history.rs` | reload path: identical mapping, identical ids (`{id}` / `{id}:result`). |
| `packages/core-rs/crates/mainframe-adapter-codex/tests/{item_types,event_mapper,history,live_vs_history_id_parity}.rs` | new cases (see gates). |
| `packages/ui/src/features/chat/tools/cards/WebFetchCard.tsx` | verb/target from args, not `toolName`; degraded header-only state. |
| `packages/ui/src/features/chat/tools/cards/__tests__/WebFetchCard.test.tsx` | new cases appended; **no existing case edited** (acceptance criterion). |
| `docs/research/adapters/codex/CONSUMED-SURFACE.md` | one row: `webSearch.action` is now consumed surface, with the breakage note (a renamed action tag silently reverts fetch to the Search face). |
| `.changeset/*.md` | patch changeset. |

Not touched: `registry.ts` / `register-cards.ts` (the adapter puts an existing registry key on the
wire), and `dynamic_tool_call_name` (see Out of scope).

## Card derivation rule (the whole UI change)

```
url   = args.url   (string)
query = args.query (string)
url present   -> verb "Fetch",  URL row + summary body   (unchanged for Claude WebFetch)
else query    -> verb "Search", quoted query, no URL row (unchanged for Claude WebSearch)
else          -> degraded: globe + verb + muted "no target" (text-muted-foreground),
                 status dot, trigger disabled, no body, never raw JSON
```

Both families now put the URL under `url` and the query under `query`, so one rule covers them; the
point of deriving from args rather than `toolName` is that the next vendor spelling needs no card
change. The degraded verb falls back to `toolName === 'WebSearch' ? 'Search' : 'Fetch'` — my call,
the brief does not say. Existing `data-testid`s unchanged; the degraded label gets one new id.

## Out of scope (with the reason, so it is not re-litigated)

- **`web__run` dynamic-tool-call normalization.** Unconfirmed as a path Mainframe ever receives —
  the brief's own rule is "unconfirmed → out of scope". If Gate 0 shows `dynamicToolCall` instead,
  see the branch note there.
- **Parsing `webSearch.results`.** The brief excludes structured result parsing; the tool_result
  content stays the empty string it is today, and the fetch card's body is the URL row.
- **`findInPage` / `other` actions**, external-session rollout scanning (`rollout_reconstruct.rs`
  reconstructs only `exec_command` and `mcp__*`, so a `web`/`run` call produces no item there at
  all), MCP cards, mobile.

## Established facts

- Codex 0.153.4's app-server `WebSearchItem` has **4** fields, `id / query / action / results`, and
  `WebSearchAction` is a tagged enum `search {query, queries} | openPage {url} | findInPage {pattern}
  | other`. Receipts: `strings -a /opt/homebrew/Caskroom/codex/0.153.4/bin/codex` — the serde field
  list `WebSearchItem id action results queries url findInPage pattern other` (strings line 446584),
  `id query action results search queries url findInPage pattern other` (441956), the variant-count
  strings `struct WebSearchItem with 4 elements`, `struct variant WebSearchAction::OpenPage with 1
  element`, `::Search with 2 elements`, `::FindInPage with 2 elements`, and the snake_case mirror
  `WebSearchAction queries open_page url find_in_page` (450341).
- The raw Responses-API form of the same tool, captured (not synthetic):
  `~/.codex/sessions/2026/07/22/rollout-2026-07-22T14-20-25-019f898e-33a8-7b00-90ee-a67a362fd1e5.jsonl`
  lines 588 and 895 — `{"type":"function_call","name":"run","namespace":"web","arguments":"{\"search_query\":[{\"q\":…}],\"response_length\":\"long\"}"}`.
  These two lines are the **only** non-`mcp__` namespaced calls in the whole local corpus
  (`grep -rhoE '"namespace":"[^"]*"' ~/.codex/sessions | sort | uniq -c` → `collaboration` 286,
  `mcp__*` 41, `clock` 13, `web` 2). This proves the wire spelling, **not** the app-server item type.
- The older hosted form shows the same action set on the wire:
  `{"type":"web_search_call","action":{"type":"open_page","url":"https://v2.tauri.app/…"}}` and
  `{"type":"search","query":…,"queries":[…]}` in the 2026-06-13 entries of that same rollout corpus.
- `web.run`'s argument schema is `codex_api::search::SearchCommands` (11 fields: `search_query,
  image_query, open, click, find, screenshot, finance, weather, sports, time, response_length`), with
  `OpenOperation {ref_id, lineno}` — `ref_id` documented "Reference id or URL to open." Receipt:
  strings lines 442040, 442044, 479809, 479819. Relevant only if Gate 0 takes the dynamic branch.
- Today both web renderers hardcode the name: `web_search_render.rs:19` and
  `web_search_history.rs:24` emit `tool_use_block(&w.id, "WebSearch", {query})` plus an empty
  tool_result (`{id}:result`). They are already a matched live/reload pair — the precedent this
  change follows.
- Unknown JSON fields are ignored crate-wide (`item_types.rs:3-8`), and a whole item that fails to
  deserialize is **dropped silently** on reload (`types.rs::deserialize_lenient_items`, lines 95-120).
  That is why `query` must become `#[serde(default)]`: if codex ever omits it on an `openPage` item,
  today's required `String` would make the fetch vanish rather than render.
- `web__search` in `tests/event_mapper.rs:489` and `tests/live_vs_history_id_parity.rs:136` is a
  **synthetic** fixture — the file says so at `live_vs_history_id_parity.rs:131` ("no fixture in this
  crate's captures contains one"). Not evidence of any Codex spelling; leave both tests untouched as
  the regression case for the un-normalized dynamic path.
- `resolveToolCard` needs no change: exact-name lookup plus an `mcp__` prefix rule
  (`packages/ui/src/features/chat/tools/registry.ts:24-30`), and `WebFetch` + `WebSearch` both
  already map to `WebFetchCard` (`register-cards.ts:43-44`).
- `docs/plans/` is gitignored (`.gitignore:53`) — this plan is committed with `git add -f`.

## Risks

- **The item type is inferred, not captured** (Gate 0 exists for exactly this).
- **A renamed or added upstream action tag** falls back to the Search face rather than breaking —
  recorded in CONSUMED-SURFACE.
- **`openPage` may also carry a non-empty top-level `query`** (the item has both). The action wins;
  state that in the code's one comment if it is not obvious from the match.
- **A fetch's body is only the URL row**, since `results` stays unparsed — that is the brief's call,
  and it matches Claude's `WebSearch`, whose result string is opaque too.

## Group 1 — shared Web card for Codex (the only implementation group)

One agent, TDD inline: write the failing test and the fix in the same turn, Rust first, then UI.

Exit gates — each must be true and observable:

0. **Confirm the item type before writing Rust.** Capture one real `item/completed` for a Codex web
   fetch (the CLAUDE.md pointer for live protocol behavior is the codex protocol-debugger skill) and
   record the frame in the PR. If it is `webSearch` with an `action`, proceed as planned. If it is
   `dynamicToolCall {namespace:"web", tool:"run"}`, switch the Rust seam to `dynamic_tool_call_name`
   (already `pub(crate)` and already shared by both paths — `thread_item_render.rs:88`,
   `history_convert.rs:17`), map on the `web.run` command keys (`open[].ref_id` that parses as
   http(s) → `WebFetch {url}`, `search_query[0].q` → `WebSearch {query}`), and note that that branch
   additionally needs a tool_result emitted from `content_items` / `success`
   (`thread_item_variants.rs:228-241`) because the dynamic path emits none today. Gates 5-8 are
   identical either way.
1. A `webSearch` item whose action is `openPage` produces a tool_use block named `WebFetch` with the
   url as input, on the live path.
2. A `webSearch` item with a `search` action, with no action at all, or with an action tag this
   crate does not know, still produces exactly today's `WebSearch` + `{query}` pair — the existing
   `web_search_renders_a_tool_use_and_tool_result_pair_named_web_search` case and the `history.rs`
   WebSearch case pass unmodified.
3. Live and history-reload emit the identical tool_use id **and** name for an `openPage` item — a new
   case in `tests/live_vs_history_id_parity.rs` following
   `dynamic_tool_call_reload_matches_the_live_tool_use_id_and_name`'s structure. This is the
   acceptance criterion's Rust parity test.
4. A `webSearch` payload missing `query` deserializes instead of being dropped (`tests/item_types.rs`,
   matching the crate's existing tolerance cases).
5. `WebFetchCard` renders "Fetch" + a clickable URL for `{url}` args, "Search" + the quoted query for
   `{query}` args, and the header-only degraded card (trigger disabled, no body, no JSON) when
   neither is present — regardless of `toolName`.
6. Clicking a URL row still calls `useHost().shell.openExternal` with that URL, via the spy the
   existing tests already install.
7. **Every pre-existing case in `WebFetchCard.test.tsx` passes with zero edits to it** — the
   acceptance criterion for "Claude rendering unchanged".
8. The Codex CONSUMED-SURFACE doc has the `webSearch.action` row, a patch changeset exists, and the
   repo's normal validation for both touched packages is green (`mainframe-adapter-codex` tests plus
   clippy/fmt; `packages/ui` unit tests, typecheck and lint — typecheck matters because it covers
   test files the build does not).
