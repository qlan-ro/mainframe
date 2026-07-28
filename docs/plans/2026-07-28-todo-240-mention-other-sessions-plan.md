# Implementation plan — reference another session with `@` (todo #240)

Spec: [`docs/specs/2026-07-28-todo-240-mention-other-sessions.md`](../specs/2026-07-28-todo-240-mention-other-sessions.md)
Branch: `todo/240-mention-other-sessions`

## Goal

Let a user reference another session from the composer without ever touching a session id: typing `@`
merges the current project's started sessions into the existing flat trigger list (agents → sessions →
files), selecting one inserts the literal text `@session[<label>] ` into the textarea, and at send the app
prepends one `Referenced session @session[<label>]: <absolute transcript path>` line per unique referenced
label above the whole composition — except when the composition is a slash command, where the lines go
*below* the command line so the leading `/` survives (decision D1). Offerability is settled *before* a row is drawn, by one batched,
adapter-aware daemon read that answers resolved / unavailable / unknown per chat; only *resolved* sessions
are offered. The rendered user message strips those reference lines before markdown parsing and turns each
inline token into a chip at the existing inline-directive seam, so the optimistic echo, the confirmed echo,
and a reload-replayed message all render identically from the body text alone.

## Decisions

**D1 — Reference lines move below the first line when the body is a slash command (deviates from AC 6 and
spec decision 6, which say "prepended").** Slash-command and skill recognition requires the message body to
*start* with `/`: the daemon's parser bails at
`packages/core-rs/crates/mainframe-adapter-claude/src/messages/message_parsing.rs:126`
(`if !text.starts_with('/') { return None; }`), and the Claude CLI applies the same precondition before it
emits the `<command-name>` tags the daemon reads. Nothing intercepts the composition client-side —
`use-submit-composition.ts` appends the serialized text verbatim — so unconditionally prepending
`Referenced session …` at offset 0 would turn `/review @session[Foo]` into prose: the command never runs,
no `SlashPill` renders, and nothing reports the failure. `prependSessionReferences` therefore keeps the
first line in place when the body starts with `/` and inserts the reference block after it (D2/F7), and
`stripReferenceLines` recognizes a reference block wherever it starts a block rather than only at offset 0
(D2), so the rendered message hides the payload in both layouts. The agent still receives the same labeled
absolute paths; only their position changes, and only for slash bodies. AC 5, 7, 9, 15, 16 and 19 are
unaffected. The pre-existing quote path is untouched and still shadows a leading `/` — a quoted composition
starts with `>`, so it never takes the slash branch and behaves exactly as it does today.

## Constraints carried from CLAUDE.md

- Max 300 lines/file, 50 lines/function — every new module below is a small single-purpose file.
- `data-testid` on every interactive element, keyed by domain id, never an array index.
- Single canonical type: the resolution DTO is declared once in `@qlan-ro/mainframe-types` and mirrored in
  `packages/core-rs/crates/mainframe-types`.
- Zod-equivalent validation on the new route (serde `Deserialize` + explicit id/shape checks → 400).
- Pure logic (sanitizing, disambiguation, line compose/parse) lives in plain modules, not React.
- No `@ts-ignore`; no silent catches; no leftovers — the `DirectiveParagraph` widening (spec decision 5)
  and the `is_*_transcript_present` re-expression land in this pass, not later.
- Changeset required before the implementation commit.

## Contracts pinned by this plan

Every group below codes against these exact signatures. Do not rename or re-derive them.

### Wire DTO (`@qlan-ro/mainframe-types`)

```ts
export type TranscriptUnavailableReason = 'never-started' | 'transcript-missing';

export type TranscriptResolution =
  | { chatId: string; state: 'resolved'; path: string }
  | { chatId: string; state: 'unavailable'; reason: TranscriptUnavailableReason }
  | { chatId: string; state: 'unknown' };

export interface ResolveTranscriptsRequest {
  chatIds: string[];
}

export interface ResolveTranscriptsResponse {
  resolutions: TranscriptResolution[];
}
```

Route: `POST /api/session-transcripts/resolve` → `ok({ resolutions })`.
(Deliberately NOT under `/api/chats/...`: a static segment sharing a level with the existing `:id` param
routes is the kind of overlap that has bitten route registration before.)

### Pure text modules (`packages/ui/src/features/chat/session-references/`)

```ts
// reference-label.ts
export const UNTITLED_SESSION_LABEL = 'Untitled session';
export function sanitizeReferenceLabel(title: string | null | undefined): string;
export function disambiguateLabels(entries: readonly { chatId: string; label: string }[]): Map<string, string>;
export function nextFreeLabel(base: string, taken: ReadonlySet<string>): string;
export function labelSlug(label: string): string;

// reference-line.ts
export function composeReferenceLines(refs: readonly { label: string; path: string }[]): string;
export function parseReferenceLine(line: string): { label: string; path: string } | null;
export function stripReferenceLines(text: string): string;
export function collectSessionTokenLabels(text: string): string[];
/** Places the reference block above the body — or below line 1 when the body is a slash command (D1). */
export function prependSessionReferences(body: string, paths: ReadonlyMap<string, string>): string;
```

### Composer session source (`packages/ui/src/features/chat/composer/sessions/`)

```ts
export interface SessionMentionSource {
  items: TriggerItem[];                  // type: 'session', id: chatId, label: reference label
  pathByChatId: ReadonlyMap<string, string>;
  refresh: () => void;                   // stable identity
}
```

---

## Task index

Sequential numbers for the lane's group extraction; the letter ids are used in prose.

| # | Task | # | Task | # | Task |
|---|------|---|------|---|------|
| 1 | A1 | 12 | E2 | 23 | F8 |
| 2 | A2 | 13 | E3 | 24 | G1 |
| 3 | B1 | 14 | E4 | 25 | G2 |
| 4 | B2 | 15 | E5 | 26 | G3 |
| 5 | B3 | 16 | F1 | 27 | G4 |
| 6 | B4 | 17 | F2 | 28 | H1 |
| 7 | C1 | 18 | F3 | 29 | H2 |
| 8 | C2 | 19 | F4 | 30 | H3 |
| 9 | D1 | 20 | F5 | 31 | H4 |
| 10 | D2 | 21 | F6 | 32 | H5 |
| 11 | E1 | 22 | F7 | 33 | H6 |

## Task list

Tasks are grouped; each group is one agent's unit of work. Within a group, do the tasks in order.

---

### Group A — `wire-types` (core)

**A1. Declare the resolution DTO in `@qlan-ro/mainframe-types`.**

- New file `packages/types/src/session-transcript.ts` with exactly the four exports in *Contracts* above.
  Doc-comment the tri-state: `unknown` means the adapter cannot determine the location and the session is
  NOT offerable (spec decision 11).
- Add `export * from './session-transcript.js';` to `packages/types/src/index.ts`, in the existing
  alphabetical-ish block next to `./setup-advisor.js`.
- Verify: `pnpm --filter @qlan-ro/mainframe-types build` succeeds and
  `node -e "console.log(Object.keys(require('./packages/types/dist/index.js')))"` is not needed — instead
  confirm `packages/types/dist/session-transcript.d.ts` exists.

**A2. Mirror the DTO in the Rust types crate.**

- New file `packages/core-rs/crates/mainframe-types/src/transcript.rs`:
  - `pub enum TranscriptLocation { Present(String), Missing }` — the *adapter-facing* result. Not
    serialized; `Option<TranscriptLocation>` where `None` = unknown.
  - `#[derive(Serialize)] #[serde(tag = "state", rename_all = "kebab-case")] pub enum TranscriptResolution`
    with variants `Resolved { chat_id: String, path: String }`,
    `Unavailable { chat_id: String, reason: TranscriptUnavailableReason }`,
    `Unknown { chat_id: String }`; add `#[serde(rename_all = "camelCase")]` on the struct variants so
    `chat_id` crosses the wire as `chatId`.
  - `#[derive(Serialize)] #[serde(rename_all = "kebab-case")] pub enum TranscriptUnavailableReason { NeverStarted, TranscriptMissing }`.
  - `#[derive(Serialize)] #[serde(rename_all = "camelCase")] pub struct ResolveTranscriptsResponse { pub resolutions: Vec<TranscriptResolution> }`.
- Register with `pub mod transcript;` in `packages/core-rs/crates/mainframe-types/src/lib.rs`.
- Add a `#[cfg(test)]` serde test in `transcript.rs` asserting the JSON of one variant of each state matches
  the TS union byte-for-byte (`{"state":"resolved","chatId":"c1","path":"/p"}`,
  `{"state":"unavailable","chatId":"c2","reason":"never-started"}`, `{"state":"unknown","chatId":"c3"}`).
- Verify: `cd packages/core-rs && cargo test -p mainframe-types transcript`.

---

### Group B — `rust-transcript-resolution` (core)

Depends on Group A (uses `mainframe_types::transcript`).

**B1. Add the optional adapter trait method.**

- `packages/core-rs/crates/mainframe-adapter-api/src/adapter.rs`, immediately after
  `is_transcript_present` (line ~238), add:

  ```rust
  /// Absolute on-disk location of the CLI transcript for `session_id`.
  /// `Ok(None)` = the adapter cannot determine the layout — callers MUST treat
  /// it as "unknown" and hide the session, never as "missing".
  fn locate_transcript(
      &self,
      session_id: String,
      project_path: String,
      session_file_path: Option<String>,
  ) -> BoxFuture<'_, Result<Option<TranscriptLocation>, AdapterError>> {
      let _ = (session_id, project_path, session_file_path);
      Box::pin(async { Ok(None) })
  }
  ```

  Import `mainframe_types::transcript::TranscriptLocation`. Update the file's trailing `PORT STATUS`
  note to mention the third optional method.
- Verify: `cargo check -p mainframe-adapter-api`.

**B2. Claude: locate, then re-express presence on top of it.**

- `packages/core-rs/crates/mainframe-adapter-claude/src/transcript.rs`:
  - `pub async fn locate_claude_transcript(session_id: &str, project_path: &str, session_file_path: Option<&str>) -> Option<TranscriptLocation>`:
    if `session_file_path` is `Some` and the file exists → `Some(Present(that path))`; else derive via the
    existing `get_session_jsonl_path(session_id, project_path)` and return `Some(Present(jsonl_path))` when
    it exists, `Some(Missing)` otherwise. Claude's layout is always known, so this never returns `None`.
    Return the path as an absolute `String`.
  - Rewrite `is_claude_transcript_present` to
    `matches!(locate_claude_transcript(..).await, Some(TranscriptLocation::Present(_)))` — one probe
    implementation, no duplicated stat logic.
- `packages/core-rs/crates/mainframe-adapter-claude/src/adapter.rs`: add the `locate_transcript` override
  next to the existing `is_transcript_present` override (line ~465), delegating to
  `locate_claude_transcript` and wrapping in `Ok(..)`.
- Tests in the `transcript.rs` `#[cfg(test)]` module (tempdir-based, mirroring the existing presence tests):
  stored `session_file_path` present → `Present(stored path)`; stored path absent but derived path present
  → `Present(derived path)`; neither present → `Missing`; and the existing
  `is_claude_transcript_present` tests still pass unmodified.
- Verify: `cd packages/core-rs && cargo test -p mainframe-adapter-claude transcript`.

**B3. Codex: locate, then re-express presence on top of it.**

- `packages/core-rs/crates/mainframe-adapter-codex/src/transcript.rs`:
  - `pub async fn locate_codex_transcript(thread_id: &str, deps: Option<&CodexTranscriptDeps<'_>>) -> Option<TranscriptLocation>`
    with exactly the existing containment semantics: `None` when the registry has no row, the row carries
    no rollout path, or the canonicalized path escapes the sessions root; `Some(Missing)` when
    `canonicalize` fails (rollout deleted); `Some(Present(resolved.to_string_lossy().into_owned()))` when
    present and contained.
  - Rewrite `is_codex_transcript_present` as a `matches!` over `locate_codex_transcript` (same
    `Option<bool>` return: `None` → `None`, `Some(Missing)` → `Some(false)`, `Some(Present)` → `Some(true)`).
- `packages/core-rs/crates/mainframe-adapter-codex/src/adapter.rs`: add the `locate_transcript` override
  next to `is_transcript_present` (line ~225), passing `None` deps like the existing override does.
- Tests in the `transcript.rs` `#[cfg(test)]` module using the injectable `LookupFn` + `sessions_root`:
  present-and-contained → `Present`; rollout deleted → `Missing`; no registry row → `None`; path escaping
  the sessions root → `None`.
- Verify: `cd packages/core-rs && cargo test -p mainframe-adapter-codex transcript`.

**B4. Add the batch resolution route.**

- New file `packages/core-rs/crates/mainframe-server/src/routes/session_transcripts.rs`:
  - `#[derive(Deserialize)] struct ResolveBody { #[serde(rename = "chatIds")] chat_ids: Option<Vec<String>> }`
    parsed with `crate::routes::projects::parse_body::<ResolveBody>(&body)` from `axum::body::Bytes`
    (the `worktree_offer.rs` pattern).
  - Validation → `fail(StatusCode::BAD_REQUEST, ..)`: body must parse; `chatIds` must be present and
    non-empty; at most 500 entries; every id must be non-empty and match `^[a-zA-Z0-9_-]+$` (write a
    small `fn valid_id(s: &str) -> bool` using `chars().all(..)`, no regex crate).
  - Per id, resolve in this order (each step's miss is stated, none silent):
    1. `ctx.db.call(move |db| db.chats.get(&id))` → `Ok(None)`/`Err` → `Unknown`.
    2. `chat.claude_session_id` is `None` → `Unavailable { reason: NeverStarted }`.
    3. `db.projects.get(&chat.project_id)` → project path; missing → `Unknown`. Working dir is
       `chat.worktree_path.unwrap_or(project_path)` (same rule as `transcript_presence.rs`).
    4. `ctx.adapter_registry.get(&chat.adapter_id)` → `None` → `Unknown`.
    5. `adapter.locate_transcript(session_id, cwd, chat.session_file_path).await`:
       `Ok(None)` → `Unknown`; `Ok(Some(Missing))` → `Unavailable { reason: TranscriptMissing }`;
       `Ok(Some(Present(p)))` → `Resolved { path: p }`; `Err(e)` → `tracing::warn!` then `Unknown`.
  - Respond `ok(ResolveTranscriptsResponse { resolutions })`.
  - `pub fn router() -> Router<Arc<AppCtx>>` mounting `post("/api/session-transcripts/resolve")`.
  - Keep the file under 300 lines by extracting the per-chat resolution into
    `async fn resolve_one(ctx: &Arc<AppCtx>, chat_id: String) -> TranscriptResolution` (< 50 lines).
- Wire it: `pub mod session_transcripts;` in `routes/mod.rs`; `.merge(routes::session_transcripts::router())`
  in `http.rs` next to the `chat_recovery` merge (line ~57).
- Tests in the same file's `#[cfg(test)]` module, using `AppCtx::test_ctx()` (real in-memory DB, empty
  `AdapterRegistry` that accepts `register(Arc<dyn Adapter>)`), seeding chats/projects through `ctx.db`,
  and covering **all five AC-21 cases plus validation**:
  1. Claude-shaped stub adapter whose `locate_transcript` returns `Present(path)` → `resolved` with that
     path.
  2. Stub returning `Missing` → `unavailable` / `transcript-missing`.
  3. Chat with `claude_session_id = None` → `unavailable` / `never-started`, and the adapter is never
     consulted (assert via a call-counter in the stub).
  4. Non-Claude adapter id (`"codex"`-registered stub) returning `Present` → `resolved` — the assertion
     for AC 18 is that the returned path is the stub's, not a `~/.claude/projects/...` path.
  5. Adapter using the trait default (no override) → `unknown`; and an unregistered `adapter_id` → `unknown`.
  6. Validation: missing `chatIds` → 400; empty array → 400; an id containing `/` or `..` → 400.
- Verify: `cd packages/core-rs && cargo test -p mainframe-server session_transcripts` and
  `cargo check` at the workspace root.

---

### Group C — `session-reference-text-tests` (test, red phase)

No dependencies. These tests are written against the *Contracts* signatures and MUST be observed failing
before Group D exists.

**C1. `packages/ui/src/features/chat/session-references/__tests__/reference-label.test.ts`**

Cases (AC 8, 12, 24; edge cases 10–12):

- `sanitizeReferenceLabel` keeps letters, digits, spaces, `…`, and `, ; ! ? ' " ( ) -`.
- Each of these titles maps to the stated label:
  - `` Why does `useEffect` fire twice `` → `Why does useEffect fire twice`
  - `Fix *foo* handling` → `Fix foo handling`
  - `Fix _foo_ [bar] <baz> ~~qux~~` → `Fix foo bar baz qux`
  - `See www.example.com now` → `See www example com now` (`.` replaced, whitespace collapsed)
  - `Ping name@example.com` → `Ping name example com`
  - `A | B # C \ D & E` → `A B C D E`
  - `Truncated title…` → `Truncated title…` (the ellipsis survives)
- Whitespace collapse and trim: `"  a \n\t b  "` → `a b`.
- Empty result falls back: `undefined`, `''`, `'***'`, `'🎉🎉'` → `Untitled session`.
- `disambiguateLabels` on `[{c1,'Foo'},{c2,'Foo'},{c3,'Bar'},{c4,'Foo'}]` (already in list order) →
  `c1: 'Foo'`, `c2: 'Foo (2)'`, `c3: 'Bar'`, `c4: 'Foo (3)'`; it never mutates its input.
- `nextFreeLabel('Foo', new Set(['Foo']))` → `'Foo (2)'`;
  `nextFreeLabel('Foo', new Set(['Foo','Foo (2)']))` → `'Foo (3)'`;
  `nextFreeLabel('Foo', new Set())` → `'Foo'`.
- `labelSlug('Foo Bar (2)')` → `foo-bar-2`; `labelSlug('  a!!b  ')` → `a-b`; `labelSlug('Untitled session')`
  → `untitled-session`.

**C2. `packages/ui/src/features/chat/session-references/__tests__/reference-line.test.ts`**

Cases (AC 5–7, 9, 24; edge cases 4–6, 15, 17, 18):

- Round trip: `parseReferenceLine(composeReferenceLines([{label,path}]).trimEnd())` returns the same
  `{label, path}` for a plain label, a label with `(2)`, and a label with `, ; ! ? ' " ( ) -`.
- `composeReferenceLines([])` → `''`.
- Every produced line matches `/^Referenced session @session\[[^\]\n]*\]: \/.+$/` (AC 5).
- `collectSessionTokenLabels('a @session[Foo] b @session[Bar] c @session[Foo]')` →
  `['Foo','Bar']` (order of first appearance, deduped).
- `collectSessionTokenLabels('email@session[x]')` → `[]` (token must be whitespace- or start-bounded).
- `prependSessionReferences(body, map)`:
  - one token with a recorded path → `line + '\n\n' + body`, body unchanged char-for-char;
  - two tokens with the same label → exactly one line (AC 7);
  - a token with no recorded path → body returned unchanged, no throw (AC 9);
  - empty map → body returned **identical by reference-equality of content** (AC 16 byte-identical);
  - body starting with a quote block (`> quoted\n\nrest @session[Foo]`) → lines sit above the quote
    (AC 6, edge case 18);
  - body that is only `@session[Foo]` → lines + blank line + the token (edge case 17);
  - **slash body (decision D1)**: `'/review @session[Foo]'` → the result still starts with `/review`, the
    reference line follows after one blank line, and the command line is unchanged char-for-char;
  - slash body with more lines (`'/review @session[Foo]\nand this'`) → `/review …`, blank, reference line,
    blank, `and this` — the text after the first newline is preserved verbatim;
  - a body starting with `>` (quote) or any non-`/` character keeps the offset-0 prepend.
- `stripReferenceLines`:
  - strips a leading run of N reference lines plus the single following blank line;
  - strips a reference run that starts a later block — specifically the D1 layout
    (`'/review\n\nReferenced session @session[Foo]: /p\n\nrest'` → `'/review\n\nrest'`) — dropping the run
    plus one adjacent blank line, so the surrounding paragraphs stay separated by exactly one blank line;
  - leaves a reference-shaped line that does NOT start a block (preceded by a non-empty line) untouched;
  - is a no-op (returns the same string) for text with no reference lines;
  - handles text that is *only* reference lines → `''`;
  - round-trips D1: `stripReferenceLines(prependSessionReferences('/review @session[Foo]', map))` ===
    `'/review @session[Foo]'`.

Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/session-references` fails
with "cannot find module" / assertion errors, and the failures are recorded before Group D starts.

---

### Group D — `session-reference-text` (core)

Depends on Group C.

**D1. `packages/ui/src/features/chat/session-references/reference-label.ts`**

- `sanitizeReferenceLabel`: replace every character outside
  `/[\p{L}\p{N} …,;!?'"()\-]/u` with a space, collapse `\s+` to one space, trim, fall back to
  `UNTITLED_SESSION_LABEL` when empty. One regex constant, one function under 15 lines.
- `nextFreeLabel(base, taken)`: return `base` when free, else `` `${base} (${n})` `` for the first free
  `n` starting at 2.
- `disambiguateLabels(entries)`: walk in order, `nextFreeLabel` against a running `Set`, return a
  `Map<chatId, label>`.
- `labelSlug(label)`: lowercase, replace `/[^a-z0-9]+/g` with `-`, trim leading/trailing `-`.
- Doc-comment *why* sanitizing beats escaping (spec decision 20) in one line.

**D2. `packages/ui/src/features/chat/session-references/reference-line.ts`**

- `SESSION_TOKEN_RE = /(?:^|(?<=\s))@session\[([^\]\n]*)\]/g` (module-private; reset `lastIndex` at every
  use or use `matchAll` on a fresh regex — the existing `MENTION_RE` bug pattern).
- `REFERENCE_LINE_RE = /^Referenced session @session\[([^\]\n]*)\]: (\S.*)$/`.
- `composeReferenceLines(refs)`: `refs.map(r => \`Referenced session @session[${r.label}]: ${r.path}\`).join('\n')`.
- `parseReferenceLine(line)`: exec `REFERENCE_LINE_RE`, return `{label, path}` or `null`.
- `stripReferenceLines(text)`: split on `\n` and remove every *block-initial* maximal run of lines matching
  `REFERENCE_LINE_RE` — block-initial means the run starts at line 0 or is preceded by an empty line —
  together with one adjacent empty line (the immediately-following one when present, otherwise the
  immediately-preceding one), so two paragraphs that surrounded a run end up separated by exactly one blank
  line. A matching line preceded by a non-empty line is left alone. Return `text` unchanged when nothing was
  dropped. The block-initial anchor (rather than offset 0 only) is what makes decision D1's layout
  strippable; doc-comment that in one line.
- `collectSessionTokenLabels(text)`: `matchAll` + `Set` preserving first-appearance order.
- `prependSessionReferences(body, paths)`: collect labels, keep those with a path, `composeReferenceLines`,
  return `body` when the list is empty. Otherwise place the block by decision D1:

  ```ts
  if (!body.startsWith('/')) return `${lines}\n\n${body}`;
  const nl = body.indexOf('\n');
  // D1: a leading `/` is the CLI's only slash-command signal — keep it on line 1.
  return nl === -1 ? `${body}\n\n${lines}` : `${body.slice(0, nl)}\n\n${lines}\n${body.slice(nl)}`;
  ```

  `body.slice(nl)` starts with the original `\n`, so everything after the command line survives verbatim.

Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/session-references` — all
Group C tests green.

---

### Group E — `trigger-engine-hooks` (ui)

No dependencies (its two new hooks take callbacks; nothing here imports the text modules).

**E1. Extend `TriggerConfig` with two additive per-item hooks.**

`packages/ui/src/components/trigger-engine/types.ts`:

```ts
/** Overrides the `<itemTestIdPrefix>-<id>` row test id for items it returns a string for. */
itemTestId?(item: TriggerItem): string | undefined;
/** Optional leading glyph for a row. Items it returns null for render no glyph node at all. */
itemGlyph?(item: TriggerItem): ReactNode;
```

Import `type ReactNode` from `react`. Both optional; every existing consumer is unaffected.

**E2. Render them in `TriggerFieldPopover.tsx`.**

- `TriggerFieldRow` gains a `trigger: TriggerConfig | null` prop (or read `field.trigger` — pick the one
  that keeps the row a pure function; `field` is already passed, so read `field.trigger`).
- Test id: `isItem ? (field.trigger?.itemTestId?.(entry) ?? \`${testIdPrefix}-${entry.id}\`) : \`${testIdPrefix}-category-${entry.id}\``.
- Glyph: compute `const glyph = isItem ? field.trigger?.itemGlyph?.(entry) : null;` and render
  `{glyph}` inside a new `<span className="flex items-center gap-1.5">` that wraps the existing label
  span. When `glyph` is `null`/`undefined` **no element is emitted** (AC 22).
- Do not change any existing class on the button or the label.

**E3. Update the engine tests for the two hooks.**

`packages/ui/src/components/trigger-engine/__tests__/` — add cases to the existing popover/field tests (or
a new `TriggerFieldPopover.test.tsx` if none exists): a config with `itemTestId` returning a custom id for
one item and `undefined` for another falls back correctly; a config with `itemGlyph` renders the node for
the matching item and renders no extra element for others; existing rows keep their prefix-derived ids.

**E4. `@session[…]` serialization in `directive-formatter.ts`.**

- `mentionDirectiveFormatter(resolveSessionLabel?: (item: TriggerItem) => string)`.
- In `serialize`: if `item.type === 'session'`, return `` `@session[${resolveSessionLabel?.(item) ?? item.label}]` ``.
  **No trailing space** — `insertDirective` owns that via `appendSpace`
  (`use-trigger-field.ts:127-129`), and `shouldCloseTriggerOnInsert` already returns `true` for every type
  but `directory`, so a session insertion gets the AC-2 trailing space with no change to that predicate.
  All other branches untouched.
- Update `__tests__/directive-formatter.test.ts`: session item with no resolver → `@session[Foo]`;
  with a resolver returning `Foo (2)` → `@session[Foo (2)]`; `shouldCloseTriggerOnInsert` is `true` for a
  session item; file/directory/agent output unchanged (AC 22).

**E5. Merge session items into the mention adapter.**

- `packages/ui/src/features/chat/composer/triggers/mention-adapter.ts`:
  `buildMentionTriggerAdapter(cache, agents, sessions: readonly TriggerItem[] = NO_SESSIONS)`, with a
  module-level `const NO_SESSIONS: TriggerItem[] = []` for stable identity.
  Inside the fuzzy branch only, after the agents match and before `...cached`:

  ```ts
  const matchedSessions = sessions.filter((s) => !q || s.label.toLowerCase().includes(q));
  return [...matched, ...matchedSessions, ...cached];
  ```

  Sessions arrive pre-ordered and pre-disambiguated; the adapter must not re-sort them.
- `use-mention-trigger-adapter.ts`: third optional param `sessions: readonly TriggerItem[] = NO_SESSIONS`
  (re-export the same constant), added to the `useMemo` deps.
- `packages/ui/src/features/automations/fields/use-automation-trigger-sources.ts` is **not** touched — the
  new param defaults away.
- Update `__tests__/mention-adapter.test.ts`: order is agents → sessions → files for a query matching all
  three; case-insensitive substring match on the session *label*; non-fuzzy modes (`@dir/`, `@/`, `@~`)
  return the cached list with **no** session rows; omitting the argument reproduces today's output exactly.

Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/components/trigger-engine` and
`... run src/features/chat/composer/triggers`.

---

### Group F — `composer-session-source` (ui)

Depends on Groups A, B, D, E.

**F1. API client — `packages/ui/src/lib/api/session-transcripts.ts`.**

```ts
export const resolveSessionTranscripts = (port: number, chatIds: string[]): Promise<TranscriptResolution[]> =>
  request<ResolveTranscriptsResponse>('POST', `${apiBase(port)}/api/session-transcripts/resolve`, { chatIds })
    .then((r) => r.resolutions);
```

Types imported from `@qlan-ro/mainframe-types`.

**F2. Draft reference store — `packages/ui/src/features/chat/composer/sessions/session-reference-store.ts`.**

Mirror `segment-store.ts` exactly (in-memory zustand, keyed by the aui thread item id, no persist,
same `__LOCALID_*` reuse caveat in the docstring):

```ts
interface SessionReferencesState {
  byThread: Record<string, Record<string, string>>;   // threadId → label → absolute path
  record: (threadId: string, label: string, path: string) => void;
  clear: (threadId: string) => void;
}
export const useSessionReferences = create<SessionReferencesState>(...);
export function sessionReferencesFor(threadId: string): ReadonlyMap<string, string>;
```

`sessionReferencesFor` reads `getState()` and returns a `Map` — the shape `prependSessionReferences` takes.

**F3. Pure item builder — `.../sessions/build-session-mention-items.ts`.**

```ts
export function buildSessionMentionItems(args: {
  sessions: readonly SessionItem[];          // regularThreadItemsToSessionItems output
  projectId: string | null;
  activeChatId: string | null;
  resolutions: ReadonlyMap<string, TranscriptResolution>;
}): { items: TriggerItem[]; pathByChatId: Map<string, string> };
```

Steps, in order:
1. Filter: `remoteId != null`, `remoteId !== activeChatId`, `custom.projectId === projectId`
   (`projectId == null` → empty result), and `resolutions.get(remoteId)?.state === 'resolved'`.
   Archived rows never arrive (the caller uses `regularThreadItemsToSessionItems`); `never-started` and
   `transcript-missing` are excluded by the resolution state alone — do not add a second client-side rule.
2. Sort by `custom.updatedAt` descending, tie-break `remoteId` ascending.
3. `sanitizeReferenceLabel(item.title)` then `disambiguateLabels` over the sorted list.
4. Map to `{ id: remoteId, type: 'session', label }` (no `description` — no path, no project label) and
   build `pathByChatId` from the resolutions.

**F4. Source hook — `.../sessions/use-session-mention-source.ts`.**

- Reads the thread list via `useAuiState((s) => s.threads.threadItems)` (select the ref, derive outside the
  selector — a derived array inside the selector loops `getSnapshot`), then
  `regularThreadItemsToSessionItems`.
- Candidate ids for the request: the filtered set from F3 step 1 *minus* the resolution check, further
  narrowed to `custom.claudeSessionId != null` so never-started chats do not inflate the batch.
- `useState<Map<string, TranscriptResolution>>` for resolutions; a `useCallback` `refresh()` that calls
  `resolveSessionTranscripts(port, candidateIds)` when `port != null && candidateIds.length > 0`, and
  writes the result into state. A `useRef` request token discards an out-of-order response. On rejection,
  `console.warn('[session-mentions] transcript resolution failed', err)` and leave the previous map
  (desktop fire-and-forget rule: tagged warn, never silent).
- `useEffect` on mount / candidate-id-set change → `refresh()`.
- Returns `{ items, pathByChatId, refresh }` via `useMemo` over `buildSessionMentionItems`.
- Keep the file under 120 lines; the pure work is already in F3.

**F5. Trigger wiring — `.../sessions/session-trigger-wiring.tsx`.**

- `export function sessionItemTestId(item: TriggerItem): string | undefined` →
  `item.type === 'session' ? \`composer-mention-session-${item.id}\` : undefined` (AC 23).
- `export function sessionItemGlyph(item: TriggerItem): ReactNode` →
  `item.type === 'session' ? <MessageSquare size={12} className="text-muted-foreground shrink-0" /> : null`
  (lucide; flagged for the design gate, AC 26).
- `export function createSessionInsertion(args: { threadId: string | null; pathByChatId: ReadonlyMap<string, string> })`
  returning `{ resolveSessionLabel, onInserted }`:
  - `resolveDraftLabel(item)` (module-private, pure, exported for test): given the item's preferred label,
    its chat id, and the current `threadId` reference map, return the preferred label when it is unused or
    already bound to *this* chat's path (edge case 6), else `nextFreeLabel(preferred, takenLabels)`
    (edge case 3).
  - `resolveSessionLabel(item)` = `resolveDraftLabel(item)`.
  - `onInserted(item)` = record `resolveDraftLabel(item) → pathByChatId.get(item.id)` into the store
    (no-op when either is missing).
  - **Load-bearing ordering, doc-comment it:** `use-trigger-field.ts:118-133` calls
    `formatter.serialize(entry)` and then `config.onInserted?.(entry)` synchronously in one function, with
    no store write in between, so both calls see the same snapshot and resolve to the same label. Anything
    that makes the store write happen between them silently desyncs the token from the recorded path.

**F6. Wire it into `ComposerTriggers.tsx`.**

- `useComposerTriggerConfigs()` returns `{ triggers, refreshSessions }`.
- Inside it: `const threadId = useActiveThreadId();` — **this, not `extras.state.chatId`**. The
  reference store and `useSubmitComposition` must key on the same id or every reference line is dropped.
- `const sessions = useSessionMentionSource({ port, projectId, activeChatId });` where `activeChatId` is
  `extras?.state.chatId ?? null` (the daemon chat id the resolution set excludes).
- `const insertion = useMemo(() => createSessionInsertion({ threadId, pathByChatId: sessions.pathByChatId }), [threadId, sessions.pathByChatId]);`
- The `@` trigger config gains:
  `formatter: mentionDirectiveFormatter(insertion.resolveSessionLabel)`,
  `itemTestId: sessionItemTestId`, `itemGlyph: sessionItemGlyph`, `onInserted: insertion.onInserted`,
  and `adapter: useMentionTriggerAdapter(mentionCache, agents, sessions.items)`.
- In `ComposerTriggers`, after `useTriggerField`:

  ```ts
  useEffect(() => {
    if (field.open && field.trigger?.char === '@') refreshSessions();
  }, [field.open, field.trigger?.char, refreshSessions]);
  ```

- If the file approaches 300 lines, move `useComposerTriggerConfigs` into a sibling
  `use-composer-trigger-configs.ts` rather than trimming comments.
- Update `__tests__/ComposerTriggers.test.tsx` for the new hook wiring (mock
  `use-session-mention-source`).

**F7. Prepend at send — `.../segments/use-submit-composition.ts`.**

```ts
const text = serializeComposition(...);
if (text === '' && state.attachments.length === 0) return;      // unchanged, still on the pre-prepend text
const body = prependSessionReferences(text, sessionReferencesFor(threadId));
...
aui.thread().append({ role: 'user', content: [{ type: 'text', text: body }], attachments, runConfig });
composer.reset();
useComposerSegments.getState().clear(threadId);
useSessionReferences.getState().clear(threadId);
```

`useCanSubmit` is **not** changed — references never make an empty draft sendable. No daemon call is made
here (AC 19: no additional resolution request during the send). Placement is the helper's business, not
this file's: `prependSessionReferences` keeps a leading `/` on line 1 (decision D1), so composing
`/review @session[Foo]` still reaches the CLI as a command.

**F8. Clear on draft reset — `packages/ui/src/features/sessions/new-thread/reset-new-thread-draft.ts`.**

Add `useSessionReferences.getState().clear(newThreadId);` next to the existing
`useComposerSegments.getState().clear(newThreadId);`, and extend the file's docstring sentence to name the
reference store.

Verify: `pnpm --filter @qlan-ro/mainframe-ui typecheck`, plus
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/composer`.

---

### Group G — `message-render` (ui)

Depends on Group D.

**G1. Recognize `@session[…]` before the bare mention — `messages/user-directives.ts`.**

- Replace the two-pass mention scan with **one** combined token regex whose session alternative comes
  first (edge case 16, AC 3):

  ```ts
  const TOKEN_RE = /(?:^|(?<=\s))(@session\[[^\]\n]*\]|@[\w./\-]+)/g;
  ```

- A session match emits `{ kind: 'mention', type: 'session', label: <full token>, id: <inner label> }`.
  `label` **must** be the full `@session[…]` token — the composer overlay pushes `seg.label` verbatim and
  its concatenated `textContent` must equal the textarea value char-for-char (AC 3). `id` is the reference
  label, which is what the chip displays.
- A plain match keeps today's `{ type: 'mention', label: token, id: token.slice(1) }`.
- Split the formatter into a factory so command recognition can be turned off (spec decision 5):

  ```ts
  export function createUserFormatter(options: { recognizeCommand: boolean }): Unstable_DirectiveFormatter;
  export const mainframeUserFormatter = createUserFormatter({ recognizeCommand: true });
  export const mainframeUserInlineFormatter = createUserFormatter({ recognizeCommand: false });
  ```

  Keep the `mainframeUserFormatter` export name and behavior for every existing consumer.
- Keep the file under 300 lines; extract the token loop into a helper if the factory pushes it over.
- Extend `__tests__/user-directives.test.ts`: `@session[Foo]` yields one `session` segment with
  `label === '@session[Foo]'` and `id === 'Foo'`; `@session` alone still parses as a plain mention;
  a label containing spaces and `(2)` parses whole; `email@session[x]` does not match; concatenating every
  segment's `text`/`label` reproduces the input exactly for a mixed string; the inline formatter emits no
  `command` segment for a leading `/foo`.

**G2. Composer overlay tint — `composer/highlight/render-highlights.tsx` + `styles/globals.css`.**

- Add `session: 'text-mf-directive-session'` to `colorClass` and extend the file's header comment.
- `globals.css`: add `--mf-directive-session` to all four theme blocks — `:root` (~line 116), `.dark`
  (~291), `.dark[data-scheme="ocean"]` (~519), `.dark[data-scheme="velvet"]` (~733) — next to
  `--mf-directive-skill`, plus `--color-mf-directive-session: var(--mf-directive-session);` in the
  `@theme inline` block (~833). Proposed amber values, distinct from skill (violet) and primary (blue),
  subject to the design gate: light `#b45309`, dark `#f0b429`, ocean `#e8b93f`, velvet `#f2b33d`.
- Add a `render-highlights` test case asserting a session token renders in a span whose class is neither
  the mention nor the skill class, and that the concatenated `textContent` equals the input (AC 3, 4).

**G3. Per-type chip renderer — `components/ui/assistant-ui/directive-text.tsx`.**

- Add to `CreateDirectiveTextOptions`:

  ```ts
  /** Per-type renderer, checked before `plainTypes` and the default chip. */
  renderers?: Record<string, FC<{ type: string; label: string; id: string }>>;
  ```

- In the segment map, before the `plainTypes` check:
  `const Custom = renderers?.[seg.type]; if (Custom) return <Custom key={i} type={seg.type} label={seg.label} id={seg.id} />;`
- Nothing else changes; existing consumers pass no `renderers`.

**G4. Strip, widen, and chip — `messages/UserMessage.tsx`.**

- `const cleanText = stripReferenceLines(meta.cleanText ?? rawText);` — the single strip point, ahead of
  `parsePlanUserMessage`, the `QueuedUserTurn content=` prop, and the `<Markdown>` body. Because
  `UserMessage` renders both the optimistic and the confirmed message, this satisfies AC 13 with no
  second code path.
- **Second strip point on the command path (decision D1).** Line ~201 sets
  `userText: metaCmd.userText ?? cleanText`, and `metaCmd.userText` is the CLI's own post-command remainder,
  which under D1 carries the reference block — it bypasses `cleanText` entirely. Change it to
  `userText: stripReferenceLines(metaCmd.userText ?? cleanText)`; the call is idempotent, so the
  `cleanText` fallback is unaffected. Without this the `SlashPill` bubble renders the raw
  `Referenced session …: /abs/path` text.
- New `SessionChip` component in this file (< 25 lines):

  ```tsx
  function SessionChip({ id }: { id: string }) {
    return (
      <span
        data-testid={`chat-message-session-chip-${labelSlug(id)}`}
        data-directive-type="session"
        className="inline-flex h-[22px] min-w-0 max-w-[230px] items-center gap-[5px] rounded-[6px]
                   border-[0.5px] border-solid border-border bg-mf-chip px-[6px] align-middle
                   font-mono text-label font-normal text-mf-directive-session"
      >
        <MessageSquare size={11} className="shrink-0" />
        <span className="truncate">{id}</span>
      </span>
    );
  }
  ```

  Label only — no path, no project, no title attribute, not a button (AC 10, spec "not clickable").
  Truncation covers edge case 13. Chrome mirrors `MainToolbar.tsx:36-37`'s `CHIP_BASE`; design gate per AC 26.
- Two directive-text components:

  ```tsx
  const CHIP_RENDERERS = { session: ({ id }) => <SessionChip id={id} /> };
  const UserDirectiveText = createDirectiveText(mainframeUserFormatter,
    { iconMap: { command: Wrench }, plainTypes: ['mention'], renderers: CHIP_RENDERERS });
  const UserInlineDirectiveText = createDirectiveText(mainframeUserInlineFormatter,
    { plainTypes: ['mention'], renderers: CHIP_RENDERERS });
  ```

- Rewrite `DirectiveParagraph` (spec decision 5, AC 11):

  ```tsx
  function DirectiveParagraph({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
    const kids = Children.toArray(children);
    return (
      <p {...props}>
        {kids.map((child, i) =>
          typeof child !== 'string' ? child
            : i === 0
              ? <UserDirectiveText key={i} type="text" text={child} status={COMPLETE} />
              : <UserInlineDirectiveText key={i} type="text" text={child} status={COMPLETE} />,
        )}
      </p>
    );
  }
  ```

  `const COMPLETE = { type: 'complete' } as const;` hoisted to module scope (no fresh object per child).
  Only the child at index 0 gets command recognition, so mixed formatting cannot invent a command chip
  mid-paragraph. This also fixes `@file` mentions inside formatted paragraphs — in scope, not deferred.
- If the file crosses 300 lines, extract `SessionChip` + the two directive-text components into
  `messages/user-directive-renderers.tsx` and import them.

Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/messages/__tests__/user-directives.test.ts`
and `... run src/features/chat/messages/__tests__/UserMessage.test.tsx`, then
`pnpm --filter @qlan-ro/mainframe-ui typecheck`.

---

### Group H — `ui-tests` (test)

Depends on Groups E, F, G. Writes **only new** test files (existing test files are owned by their
implementation group) plus the changeset.

**H1. `src/features/chat/composer/sessions/__tests__/build-session-mention-items.test.ts`** (AC 8, 17, 24)

- Ordering: three resolved sessions with distinct `updatedAt` come back most-recent-first; equal
  `updatedAt` tie-breaks on `remoteId` ascending.
- Each exclusion, one case apiece: the active chat id; a session in another project; a session whose
  resolution is `unavailable`/`never-started`; `unavailable`/`transcript-missing`; `unknown`; a session
  with no resolution entry at all; `projectId === null` → empty.
- Label disambiguation across two identical titles and two titles differing only in sanitized characters
  (`` Fix `foo` handling `` / `Fix *foo* handling`) → `Fix foo handling` and `Fix foo handling (2)`, with
  `pathByChatId` carrying each session's own path.
- Untitled session → `Untitled session` label.
- No item carries a `description`.

**H2. `src/features/chat/composer/sessions/__tests__/session-trigger-wiring.test.tsx`** (AC 23, edge cases 3, 6)

- `sessionItemTestId` returns `composer-mention-session-<chatId>` for a session item and `undefined` for
  file/agent/directory items.
- `sessionItemGlyph` returns a node for session items and `null` otherwise.
- `createSessionInsertion`: serialize-then-onInserted (in that order, mimicking `selectEntry`) records
  `label → path`; re-picking the *same* session reuses the same label and writes no second entry; picking
  a *different* session whose sanitized label collides takes `(2)` in both the serialized token and the
  recorded key; a `threadId` of `null` or a chat id missing from `pathByChatId` records nothing and does
  not throw.

**H3. `src/features/chat/composer/sessions/__tests__/use-session-mention-source.test.tsx`** (AC 17, 19)

- Mount with a mocked `resolveSessionTranscripts`: one call on mount with only the candidate ids
  (never-started chats excluded from the request payload).
- `refresh()` issues a second call; an out-of-order (slower, earlier) response does not overwrite the newer
  map.
- A rejected request leaves the previous items in place and logs one tagged `console.warn`.

**H4. `src/features/chat/composer/sessions/__tests__/submit-references.test.ts`** (AC 5–7, 9, 15, 19; edge cases 4–7, 17, 18)

Drive `useSubmitComposition` with a fake aui composer/thread (follow the existing composer-segment test
harness):

- One token + a recorded path → `append` receives `line + '\n\n' + body`; the reference line matches
  `/^Referenced session @session\[[^\]\n]*\]: \/.+$/` and the body contains no chat id and no CLI session id.
- Two tokens, same label → one line. Two tokens, different labels → two lines with the two paths.
- Hand-typed `@session[Nonexistent]` → no line, no throw, `append` still called.
- Multi-quote composition → lines above the first `>` block.
- **Slash composition (decision D1):** a draft of `/review @session[Foo]` → the appended text still starts
  with `/review` (assert `text.startsWith('/review')`, which is exactly the daemon's
  `parse_raw_command` precondition), the reference line for `Foo` is present, and
  `stripReferenceLines(appended)` returns the draft unchanged. Same assertion for `/review @session[Foo]`
  followed by a second line of prose, with the second line preserved verbatim.
- The reference store is cleared after a successful send, and `resolveSessionTranscripts` is never called
  during submit.

**H5. `src/features/chat/messages/__tests__/UserMessage.session-chip.test.tsx`** (AC 10–14, 16, 24)

- Optimistic message (`meta.cleanText` absent, raw text carrying lines + token) renders one
  `chat-message-session-chip-<slug>` and no `Referenced session` text; the confirmed message with the same
  body renders identical markup (assert on `innerHTML` equality of the two renders — AC 13).
- Two tokens with the same label render two chips.
- `see **this** @session[Foo]` renders `<strong>` and the chip; no raw `@session[` text in
  `container.textContent` (AC 11).
- A message referencing a markdown-syntax title (`@session[Why does useEffect fire twice]` with the
  reference line above) renders exactly one chip, contains no `<code>` element, and shows no raw
  `@session[` fragment (AC 12).
- A "replayed" message (only the body text, no metadata) reproduces the chip (AC 14).
- Command message (decision D1): `meta.command = { name: 'review', source: 'commands', userText:
  'Referenced session @session[Foo]: /p\n\nlook at this' }` renders the `SlashPill` and `look at this`,
  and `container.textContent` contains no `Referenced session` and no absolute path.
- A message whose text matches neither shape renders byte-identically to the pre-change output — snapshot
  a plain-markdown message and a plain `@file` mention message (AC 16).
- Chip test id slug: label `Foo Bar (2)` → `chat-message-session-chip-foo-bar-2`.

**H6. Changeset + final verification.**

- `pnpm changeset` → `@qlan-ro/mainframe-ui` **minor** and `@qlan-ro/mainframe-types` **minor**; summary:
  "Reference another session from the composer with `@`".
- `pnpm --filter @qlan-ro/mainframe-types build`
- `pnpm --filter @qlan-ro/mainframe-ui typecheck`
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/session-references src/features/chat/composer src/features/chat/messages src/components/trigger-engine`
- `cd packages/core-rs && cargo test` (AC 21, 25) and `cargo fmt --check && cargo clippy --all-targets`.
- Confirm `packages/ui/src/features/automations/fields/use-automation-trigger-sources.ts` is untouched in
  `git diff --stat` (AC 22 guard).
- Confirm no file crossed 300 lines: `git diff --name-only main | xargs wc -l | sort -n | tail`.

---

## Design gate (AC 26)

Three surfaces need `needs-ui` review before the PR is marked ready, each already implemented to a
concrete default so the reviewer edits rather than invents:

1. The picker row glyph (`MessageSquare`, 12px, `text-muted-foreground`).
2. The composer token tint (`--mf-directive-session`, amber, four themes).
3. The sent-message chip (`CHIP_BASE`-derived, 22px, truncating at 230px, glyph + label).

## Risks and explicit non-goals

- **Label/path desync (F5).** The whole draft-recording mechanism rests on `selectEntry` calling
  `serialize` then `onInserted` synchronously with no store write between. H2 pins that ordering in a test;
  an assistant-ui or engine change that splits them breaks references silently, not loudly.
- **Stale path at send (spec decision 12).** A session deleted between the picker read and the send still
  contributes its line. Intentional; the agent reports the missing file.
- **Mock-CLI sessions are never offerable.** `mainframe-adapter-mock` uses the trait default, so it returns
  `unknown`. That is correct per decision 11 but means E2E fixtures cannot exercise the picker until the
  mock adapter grows a `locate_transcript` override — out of scope here, no E2E task in this plan.
- **`@session` as a literal word.** `@session` without brackets still highlights as a plain file mention;
  that is the existing behavior and is not changed.
- **No chip inside a command bubble (decision D1).** The `SlashPill` branch renders `slashProps.userText` as
  a raw string, not through `createDirectiveText`, so a `@session[…]` token in a `/command` message shows as
  literal text. The reference line is still stripped and still reaches the agent; only the chip chrome is
  absent. Routing the command bubble through the directive renderer is a separate change.
