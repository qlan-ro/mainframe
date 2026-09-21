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
  with `search {query, queries}`, `openPage {url}`, `findInPage {url, pattern}`, `other`.
- Our `WebSearchItem` models only `{id, query}` (`thread_item_variants.rs:110`) and drops `action`
  on the floor, so a Codex **fetch** today renders the Web card with the wrong verb ("Search") and
  no URL — it is not the raw-JSON fallback the brief described.

So the seam is `WebSearchItem` + its two renderers, **not** `dynamic_tool_call_name`. That also ties
off **acceptance criterion 2**, whose "…and when it arrives as a dynamic tool call" clause a reviewer
will look for: `dynamicToolCall` is codex's carrier for tools the **client** declares in the
`thread/start` `dynamicTools` param, and Mainframe declares none (`session.rs:212-259` sends only
`model / cwd / persistExtendedHistory / persistFullHistory / approvalPolicy / sandbox /
experimentalRawEvents`). `web.run` is codex-owned, so that arrival shape is structurally impossible
here, not merely unobserved — the clause is satisfied vacuously and needs no code. Receipts in
**Established facts**. The item type is inferred from codex's own struct shape, not from a captured
`item/completed` frame — Gate 0 below closes that gap before any code is written, and the
alternative branch is spelled out so a surprise there is a redirect, not a replan.

## Acceptance criterion 1 — amended (the PR must carry this deviation)

The brief's AC1 reads: "A Codex web-fetch tool call renders the shared Web card with the 'Fetch'
verb, a clickable URL, **and the result summary in the body**." This plan delivers the first two
clauses and **not** the third. A Codex fetch card's body is the URL row alone; `SummaryBody` never
renders, because the tool_result content stays `""` and the card gates the summary on a non-empty
result text (`WebFetchCard.tsx:86-94`).

Why — on receipts, not on the brief's premise:

- The app-server `WebSearchItem` *does* carry a fourth field, `results`. The Established-facts
  receipt is real and the brief's stated premise ("Codex's search item carries no result payload")
  is wrong as written. This plan does not lean on it.
- But `results`' element type is **unnamed**: `WebSearchResult` appears **0 times** in
  `strings -a /opt/homebrew/Caskroom/codex/0.153.4/bin/codex`, and in both serde field tables —
  `WebSearchItem id action results queries url findInPage pattern other` (strings line 446584) and
  `WebSearchItem query action results` (line 453672) — `results` is followed immediately by the
  `WebSearchAction` fields, with no element-struct field names anywhere in the binary. It is a
  `Vec<String>` or opaque JSON, and its **content is unverified**: we know the field exists, not
  what text it holds nor whether it is ever populated for `openPage`.
- Every captured `open_page` item in the local corpus is action-only, with no result payload of any
  kind: `{"type":"web_search_call","status":"completed","action":{"type":"open_page","url":"https://v2.tauri.app/develop/calling-rust/"}}`
  (`~/.codex/sessions/2026/06/13/rollout-2026-06-13T07-54-52-019ebf55-33d4-74f1-aa87-e87f352f2f08.jsonl`,
  ordinals 32 and 35).
- The brief's Out of scope is explicit: "Adding structured parsing of web-search *results* … the
  summary stays free text." Piping an unnamed field of unverified content into `SummaryBody` is that
  parsing. It would also change today's Codex **Search** card, since `results` sits on the item for
  `search` too — a rendering change no acceptance criterion asks for and Gate 2 forbids.

Resolution: `results` is **not** added to our `WebSearchItem` (unknown fields are ignored crate-wide,
so an unread field would be dead code); the tool_result content stays `""` on both paths; AC1 is met
in its first two clauses only. Gates 1, 3 and 5 assert the empty body explicitly, so "no summary" is
pinned as intentional rather than left to drift. **The PR body must carry the deviation** — "AC1's
result-summary clause is not delivered: Codex's `webSearch.results` is an unnamed field of unverified
content and the brief excludes result parsing" — and the acceptance checklist must record AC1 as
*partially met* with that note, never as met.

## Files touched

| File | Change |
| --- | --- |
| `packages/core-rs/crates/mainframe-adapter-codex/src/thread_item_variants.rs` | `WebSearchItem` gains `action: Option<WebSearchAction>`; `query` becomes `#[serde(default)]` so an action-only item can never be dropped. New `WebSearchAction` enum mirroring codex's tags (`search`, `openPage`, `findInPage`, `other`) with an unknown-variant tolerance consistent with this crate's lenient style. Watch the 300-line ceiling — the file is near it; a new `web_search_action.rs` is fine if it crosses. |
| `packages/core-rs/crates/mainframe-adapter-codex/src/web_search_render.rs` | live path: `openPage` → tool_use named `WebFetch` with input `{url}`; everything else (including a missing/`other` action) keeps today's `WebSearch` + `{query}`. The already-complete empty tool_result pair stays — `tool_result_block(&w.id, "", false, None)`, see **Acceptance criterion 1 — amended**. Also reword the module `//!` and fn `///` comments: they claim the item "carries only the query — no result payload ever follows it", which the `results` receipt disproves. One line, stating instead that `results` is deliberately not consumed. |
| `packages/core-rs/crates/mainframe-adapter-codex/src/web_search_history.rs` | reload path: identical mapping, identical ids (`{id}` / `{id}:result`), identical empty tool_result. Its `///` comment repeats the same disproved "carries only the query" claim — reword it the same way. |
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
url present   -> verb "Fetch",  URL row + summary body iff result text non-empty
                 (unchanged for Claude WebFetch; Codex fetch has none — see amended AC1)
else query    -> verb "Search", quoted query, no URL row (unchanged for Claude WebSearch)
else          -> degraded: globe + verb + muted "no target" (text-muted-foreground),
                 status dot, trigger disabled, no body, never raw JSON
```

Both families now put the URL under `url` and the query under `query`, so one rule covers them; the
point of deriving from args rather than `toolName` is that the next vendor spelling needs no card
change. The degraded verb falls back to `toolName === 'WebSearch' ? 'Search' : 'Fetch'` — my call,
the brief does not say. Existing `data-testid`s unchanged; the degraded label gets one new id.

## Out of scope (with the reason, so it is not re-litigated)

- **`web__run` dynamic-tool-call normalization.** Not merely unconfirmed — structurally unreachable:
  `dynamicToolCall` carries only tools the client declares via `thread/start`'s `dynamicTools`, and
  Mainframe declares none (receipt in Established facts). The captured `{"namespace":"web",
  "name":"run"}` rollout lines are the **Responses-API** wire form, which codex converts to
  `WebSearchAction` before the app-server layer — its typed `SearchCommands` parser and the plural
  `search {query, queries}` tag are that conversion. Writing a normalizer for this path would be
  dead code. If Gate 0 nonetheless shows `dynamicToolCall`, see the branch note there.
- **Parsing `webSearch.results`.** Not because the item lacks a result field — it has one — but
  because that field's element type is unnamed and its content unverified (`WebSearchResult`: 0 hits
  in the binary; every captured `open_page` item is action-only), and the brief excludes structured
  result parsing outright ("the summary stays free text"). Reading it would also alter today's Codex
  **Search** card, which Gate 2 forbids. The field is not added to our struct and the tool_result
  content stays `""` on both paths. Its consequence for AC1 is stated, not hidden: see
  **Acceptance criterion 1 — amended**.
- **`findInPage` / `other` actions**, external-session rollout scanning (`rollout_reconstruct.rs`
  reconstructs only `exec_command` and `mcp__*`, so a `web`/`run` call produces no item there at
  all), MCP cards, mobile.

## Established facts

- Codex 0.153.4's app-server `WebSearchItem` has **4** fields, `id / query / action / results`, and
  `WebSearchAction` is a tagged enum `search {query, queries} | openPage {url} | findInPage {url,
  pattern} | other` — `FindInPage` carries **2** fields per its variant-count string, the `url` being
  the one the serde field table already lists once and shares. Receipts: `strings -a /opt/homebrew/Caskroom/codex/0.153.4/bin/codex` — the serde field
  list `WebSearchItem id action results queries url findInPage pattern other` (strings line 446584),
  `id query action results search queries url findInPage pattern other` (441956), the variant-count
  strings `struct WebSearchItem with 4 elements`, `struct variant WebSearchAction::OpenPage with 1
  element`, `::Search with 2 elements`, `::FindInPage with 2 elements`, and the snake_case mirror
  `WebSearchAction queries open_page url find_in_page` (450341).
- **`results` is a field we can see but not read.** No `WebSearchResult` type exists in the binary
  (`strings -a … | grep -c 'WebSearchResult'` → `0`), and the deserializer struct-name table at
  strings line 450535 lists only `struct WebSearchItem`, `struct variant WebSearchAction::OpenPage /
  ::FindInPage / ::Search` — no element struct. In both serde field tables `results` is followed
  straight by the action fields. So the element type is a bare `String` or opaque JSON, and nothing
  in the binary or the capture corpus says what it contains or when it is populated. This is the
  receipt behind **Acceptance criterion 1 — amended**.
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
- `dynamicTools` is a **`thread/start` request param**, not an event shape: the binary's param-struct
  serde field list reads `dynamicTools selectedCapabilityRoots mockExperimentalField
  experimentalRawEvents` (`strings -a /opt/homebrew/Caskroom/codex/0.153.4/bin/codex | grep -o
  'dynamicTools[A-Za-z_]*'`), and `experimentalRawEvents` in that same list is a key Mainframe
  demonstrably does send (`session.rs:255`). Mainframe never sends `dynamicTools`
  (`thread_params_base`, `session.rs:212-223`, plus the `thread/start` arm at `session.rs:252-256`),
  so no codex-owned tool — `web.run` included — can reach us as a `dynamicToolCall`.
- Mainframe sends **no tools config at all** on turn start: `CodexTurnConfig` is
  `collaborationMode / serviceTier / personality / summary` only (`turn_config.rs:20-33`). Whether
  the web tool is available at all is codex's and the account's decision, not ours — which is why
  Gate 0 has a no-capture fallback.
- `resolveToolCard` needs no change: exact-name lookup plus an `mcp__` prefix rule
  (`packages/ui/src/features/chat/tools/registry.ts:24-30`), and `WebFetch` + `WebSearch` both
  already map to `WebFetchCard` (`register-cards.ts:43-44`).
- `docs/plans/` is gitignored (`.gitignore:53`) — this plan is committed with `git add -f`.

## Risks

- **The item type is inferred from codex's own struct shape, not from a captured frame.** Gate 0
  exists for exactly this, and its no-capture fallback is only safe because every added branch
  degrades to today's behavior; if that stops being true during implementation, the capture becomes
  mandatory again.
- **A renamed or added upstream action tag** falls back to the Search face rather than breaking —
  recorded in CONSUMED-SURFACE.
- **`openPage` may also carry a non-empty top-level `query`** (the item has both). The action wins;
  state that in the code's one comment if it is not obvious from the match.
- **A fetch's body is only the URL row**, since `results` is an unnamed field of unverified content
  and stays unread. This is a stated deviation from the brief's AC1, not an oversight
  (**Acceptance criterion 1 — amended**), and the PR body must carry it. If the Gate 0 capture shows
  `results` populated with readable text for `openPage`, that is a follow-up todo — not a silent
  in-scope addition, because the same field would also start feeding the Search card.

## Group 1 — shared Web card for Codex (the only implementation group)

One agent, TDD inline: write the failing test and the fix in the same turn, Rust first, then UI.

Exit gates — each must be true and observable:

0. **Confirm the item type before writing Rust — time-boxed, not a blocker.** Try to capture one
   real `item/completed` for a Codex web fetch (the CLAUDE.md pointer for live protocol behavior is
   the codex protocol-debugger skill) and record the frame in the PR. **If no capture is obtainable**
   — the web tool is not enabled for the account, nothing in the local `~/.codex/sessions` corpus is
   recent (one `web_search_call`, June 2026; two `namespace:"web"` calls, July 2026), and Mainframe
   sends no tools config to turn it on — **proceed on the binary-schema receipt and say so in the
   PR**. That is safe because every branch this change adds degrades to today's exact behavior when
   the shape surprises us: an absent `action`, an unknown action tag, and a missing `query` all land
   on the existing `WebSearch` + `{query}` pair, and the card's degraded state replaces raw JSON
   rather than any current rendering. Do not burn a long session chasing the frame. If the capture
   arrives and is `webSearch` with an `action`, proceed as planned. If it is
   `dynamicToolCall {namespace:"web", tool:"run"}`, switch the Rust seam to `dynamic_tool_call_name`
   (already `pub(crate)` and already shared by both paths — `thread_item_render.rs:88`,
   `history_convert.rs:17`), map on the `web.run` command keys (`open[].ref_id` that parses as
   http(s) → `WebFetch {url}`, `search_query[0].q` → `WebSearch {query}`), and note that that branch
   additionally needs a tool_result emitted from `content_items` / `success`
   (`thread_item_variants.rs:228-241`) because the dynamic path emits none today. Gates 5-8 are
   identical either way.
1. A `webSearch` item whose action is `openPage` produces a tool_use block named `WebFetch` with the
   url as input, on the live path, **and its paired tool_result content is asserted to be exactly
   `""`** — the assertion that pins amended AC1's empty body as intentional. A payload that also
   carries a `results` field produces that same empty tool_result (the field is ignored, not read).
2. A `webSearch` item with a `search` action, with no action at all, or with an action tag this
   crate does not know, still produces exactly today's `WebSearch` + `{query}` pair — the existing
   `web_search_renders_a_tool_use_and_tool_result_pair_named_web_search` case and the `history.rs`
   WebSearch case pass unmodified.
3. Live and history-reload emit the identical tool_use id **and** name for an `openPage` item, with
   the identical empty tool_result content on both paths — a new
   case in `tests/live_vs_history_id_parity.rs` following
   `dynamic_tool_call_reload_matches_the_live_tool_use_id_and_name`'s structure. This is the
   acceptance criterion's Rust parity test.
4. A `webSearch` payload missing `query` deserializes instead of being dropped (`tests/item_types.rs`,
   matching the crate's existing tolerance cases).
5. `WebFetchCard` renders "Fetch" + a clickable URL for `{url}` args — with **no
   `web-fetch-card-summary` element when the result text is empty** (the Codex fetch shape, amended
   AC1) and with one when the result text is non-empty (the Claude shape, unchanged) — "Search" +
   the quoted query for `{query}` args, and the header-only degraded card (trigger disabled, no body,
   no JSON) when neither is present, regardless of `toolName`.
6. Clicking a URL row still calls `useHost().shell.openExternal` with that URL, via the spy the
   existing tests already install.
7. **Every pre-existing case in `WebFetchCard.test.tsx` passes with zero edits to it** — the
   acceptance criterion for "Claude rendering unchanged".
8. The Codex CONSUMED-SURFACE doc has the `webSearch.action` row, a patch changeset exists, and the
   repo's normal validation for both touched packages is green (`mainframe-adapter-codex` tests plus
   clippy/fmt; `packages/ui` unit tests, typecheck and lint — typecheck matters because it covers
   test files the build does not).
