# Todo #363: tool-result images render as images, not as a System marker

Source: approved agent brief and design direction on todo #363 (route: no-spec). Prototype for placement and
states: local commit `c58beeec` (`packages/ui/src/prototype/ToolResultImage*.tsx`). It is for reference only
and must not be merged.

## Goal

When a Claude tool returns an image (for example, `Read` on a PNG):

- The CLI's `[Image: original WxH …]` coordinate note never appears in the transcript. This holds at top
  level, inside subagents, live, and after reload.
- The image travels as structured data through adapter → `MessageContentNode::ToolResult` →
  `ToolCallResult` → ACP `image` content entries → UI card result. It is never stringified base64.
- `ReadFileCard`, the fallback tool card, and the MCP marker card show clickable thumbnails while collapsed.
  A click opens the existing `ImageLightbox`.

Expected source diff (excluding tests) is about 300 lines, so this plan uses the standard form with two
groups.

## Group A — core: adapter, shared types, ACP encoder (Rust)

Files:
- `packages/core-rs/crates/mainframe-types/src/content.rs` gains `ToolResultImage { media_type, data }`.
  Use camelCase serde. It lives here because `chat.rs` (488 lines) and `display.rs` are already large and
  both import from this module.
- `mainframe-types/src/chat.rs`: add `MessageContentNode::ToolResult.images: Vec<ToolResultImage>` with
  `#[serde(default, skip_serializing_if = "Vec::is_empty")]`.
- `mainframe-types/src/display.rs`: add `ToolCallResult.images: Vec<ToolResultImage>` with the same attrs.
- `mainframe-adapter-claude/src/history_tool_result.rs`:
  - Add `extract_tool_result_images(content)`, which returns `source.type == "base64"` image blocks in
    source order.
  - `extract_tool_result_content` returns the joined text when text blocks exist. It returns `""` for an
    image-only array (no JSON, no base64). For any other non-text array it keeps today's JSON fallback.
  - `build_tool_result_blocks` fills `images`.
- `mainframe-adapter-claude/src/user_event.rs`:
  - Add `"isSynthetic"`/`"is_synthetic"` to the `is_meta` key list in `handle_user_event`.
  - `handle_subagent_user_event` computes the same flag from `event`. When the flag is set, it drops plain
    text (both the string-content and array-text branches) after the skill checks. Tool results still flow.
- `mainframe-adapter-claude/src/history_subagents.rs`: `attach_subagent_tool_results` rebuilds the
  `ToolResult` field by field, so it must carry `images` across.
- `mainframe-adapter-claude/src/messages/display_helpers.rs`: `to_tool_call_result` copies `images`. They
  are not passed through `truncate_tool_content`.
- `mainframe-acp/src/encoder/result_content.rs`: `result_content` appends one
  `ToolCallContent::Content { ContentBlock::Image { data, mime_type, uri: None, meta: None } }` per image,
  after the text entry and before the diff entry. The truncation threshold is unaffected.
- Every other struct-literal construction of `ToolResult {` / `ToolCallResult {` adds
  `images: Vec::new()` so the crates compile. `cargo check --workspace --tests` finds them. The known
  sites are in the codex history, the mock task bridge, the chat permission manager, the server
  `chat_deps`, the adapter-api tests and the chat tests.
- `docs/research/adapters/claude/CONSUMED-SURFACE.md` (CLAUDE-EVT-03, plus the tool_result row) must
  record two facts. First, stream-json marks meta user messages with `isSynthetic` (no `isMeta`), while
  the JSONL writes `isMeta: true, turnCompanion: true`. Second, `tool_result.content` can carry `image`
  blocks.

TDD (red first, in this group):
1. Synthetic suppression. Test a top-level stream-json user event with string content
   `"[Image: original 1206x2622, displayed at 920x2000. Multiply coordinates by 1.31 to map to original image.]"`
   and `isSynthetic: true` → no `on_cli_message`. Test the same event with a non-empty
   `parent_tool_use_id` → no `on_subagent_child` text. Reuse `events.rs`'s `RecordingSink`. `events.rs` is
   1653 lines, so put the new cases in a sibling test module file rather than growing it.
2. Builder unit tests: image-only content → one image (`image/png`, `<b64>`) and text containing neither
   `<b64>` nor serialized JSON. Mixed `[text, image, image]` → the text is kept and both images arrive in
   order.
3. Parity integration test: a new `tests/` file modelled on `tests/live_vs_history_id_parity.rs`. Feed
   one user entry with an image `tool_result` through `events::handle_stdout` and through
   `history_converters::convert_history_entry`. Both produce the same `ToolResult` with its images. The
   recording sink must capture `on_tool_result` content.
4. Encoder tests in `encoder/tests/result_content_tests.rs` cover two cases:
   - A result with images → text entry first, then one image entry per image (`mimeType` + `data`).
   - A result without images → encodes byte-identically to today.

Exit: the new and existing adapter, types and ACP tests pass, including the skill-injection,
replay/`skips_cli_message_when_replay`, compaction-suppression and non-synthetic CLI-feedback tests. The
golden fixtures in `mainframe-types/tests` also pass, which is expected because `images` is omitted when
empty. clippy is clean.

## Group B — ui: TS contracts, ACP conversion, thumbnails (depends on A)

Files:
- `packages/types/src/display.ts` and `chat.ts`: add `ToolResultImage { mediaType; data }` and an
  optional `images?: ToolResultImage[]` on `ToolCallResult` and the `tool_result` `MessageContent`. These
  mirror Group A's Rust shape.
- `packages/ui/src/features/chat/view-model/convert-acp-item.ts`:
  - `toolCallResult` collects `content` entries whose block is `image` into `images`.
  - When the list is non-empty it returns an object `{ content: text, images, …other fields }` (merged
    with the diff/truncation/askUserQuestion shapes).
  - Without images, the return value is unchanged (a plain string in the common case).
- `packages/ui/src/features/chat/tools/shared/result.ts`:
  - Add `resultImages(result): ToolResultImage[]`.
  - `resolveResultText` treats an object carrying `images` as `{ text: content }`. Without this, the
    ladder falls through to `JSON.stringify`, which leaks base64.
  - Export both from `shared/index.ts`.
- New `packages/ui/src/features/chat/tools/shared/ToolResultImageThumbs.tsx`:
  - Props: `toolCallId`, `images`. Renders a `flex flex-wrap gap-1` row of bare `Attachment size="xs"`
    tiles.
  - Per-tile state comes from `<img onLoad/onError>`: pending → `state="processing"`, loaded →
    `state="done"` with a trigger, failed → `state="error"` with `ImageOffIcon` and no trigger.
  - Each tile has `data-testid="tool-result-image-${toolCallId}-${index}"`.
  - The component owns the open index and renders one `ImageLightbox` over all images, fed as data URLs.
  - Every click and Enter/Space handler calls `stopPropagation`.
- `packages/ui/src/features/chat/tools/shared/card-shell.tsx`: add an optional `headerAccessory` slot,
  rendered in the header row outside the `CollapsibleTrigger` (see Risks). When the slot is absent, the
  markup is unchanged.
- `ReadFileCard.tsx`:
  - Pass the thumbnails through `headerAccessory`. Keep the visual order meta → thumbs → StatusDot; when
    thumbnails are present, StatusDot may move into the accessory.
  - Show no "· N lines" meta when the text is empty.
  - An image-only result has no body, so the trigger stays disabled.
  - Text-only results render exactly as today.
- Fallback card: `ToolFallback` lives in `components/ui/assistant-ui`, which must not import `features/`.
  - Add `features/chat/tools/cards/FallbackToolCard.tsx`, composing `ToolFallback.Root/Trigger/Content/
    Args/Result/Error` with a thumbnail row between the trigger and the content, so it is visible while
    collapsed.
  - Pass the resolved text (not the raw object) to `ToolFallback.Result` only when images are present.
  - `tool-dispatch.tsx` falls back to `FallbackToolCard`.
- `MCPToolCard.tsx`: MCP tools route here via `registry.ts`, not to `ToolFallback`.
  - Render `ToolResultImageThumbs` under the marker pill.
  - `extractResultText` must not `JSON.stringify` an image-carrying result.
- `.changeset/*.md`: patch for `@qlan-ro/mainframe-ui` and `@qlan-ro/mainframe-types`, with user-facing
  copy.

TDD (red first, in this group):
1. `convert-acp-item-tool-results.test.ts`:
   - A tool-call item with a text entry plus two image entries → the result has `content` text and
     `images` in order.
   - An item without images → the result is identical to today.
2. `result.test.ts`: `resolveResultText` / `resultImages` on an image-carrying object → no JSON, and
   images are returned.
3. `ReadFileCard.test.tsx`:
   - An image-only result renders `tool-result-image-<id>-0` while collapsed.
   - Clicking it opens `image-lightbox-dialog` and does not toggle the card.
   - There is no "line" meta, and no base64 or JSON text appears in the document.
   - The existing text-only tests pass unchanged.
4. A fallback card test and an `MCPToolCard.test.tsx` case: an image result renders the thumbnail and the
   lightbox opens.

Exit:
- UI typecheck, types `tsc --noEmit` and the touched vitest files pass.
- Live check (Tauri or browser test env, per the development reference): a Claude session `Read`s a PNG.
  A thumbnail shows in the Read card, no `[Image: …]` marker appears, and the same holds after reloading
  the chat.

## Decisions

- The coordinate note is hidden. Showing sidecar dimensions (`file.dimensions`) in the header is
  optional in the brief and is not built. This keeps `toolUseResult` parsing out of scope.
- `MCPToolCard` is in scope. The brief expects MCP screenshots to benefit via the fallback card, but MCP
  tools never reach it. Without the change, an image result in the MCP card would also dump base64 JSON.
- Tests stay with their implementation in each group. B depends on A only for the live end-to-end
  check; B's unit tests use ACP fixtures.
- File-size criterion: new files stay under 300 lines, and already-oversized files grow by no more than a
  few lines each. Splitting them is separate work.

## Risks

- **Interactive thumbnails inside the trigger button.** `CollapsibleCardShell` renders `trailing` inside
  the `CollapsibleTrigger` `<button>`, which is disabled when there is no body (image-only Read). Putting
  thumbnails there causes three problems:
  - Nested interactive content.
  - Browser-dependent click delivery inside a disabled button (the app runs in a WebKit webview).
  - Clicks from the lightbox portal bubbling through the React tree to the trigger and toggling the card.

  The prototype put them in `trailing` only because every variant-A card was disabled. Hence the
  `headerAccessory` slot outside the trigger.
- **Oversized files.** `user_event.rs` (483), `chat.rs` (488), `display_helpers.rs` (846),
  `history_subagents.rs` (378) and `events.rs` (1653) are already over 300 lines. Keep net growth in them
  to a few lines, and put new logic and tests in new or under-300 files. The brief's "no touched file
  over 300" cannot hold literally without unrelated splits (see decisions).
- **Wide field addition.** Adding a struct field breaks every struct-literal site across crates. This is
  mechanical, and the compiler finds all of them.
- **Behaviour change.** A text-less array with no image blocks keeps the JSON fallback. Only image-only
  arrays change to `""`.

## Established facts

- The image-only JSON leak comes from `extract_tool_result_content` in
  `mainframe-adapter-claude/src/history_tool_result.rs`, which falls back to `serde_json::to_string(value)`
  when no text blocks exist.
- Only `isMeta`/`is_meta` gate CLI feedback today: `handle_user_event` in `user_event.rs` computes
  `is_meta` from `event_bool(event, &["isMeta", "is_meta"])`. Skill checks run before that gate in both the
  string and array branches.
- `handle_subagent_user_event` (`user_event.rs`) pushes text with no meta check. Its tool results
  round-trip through `serde_json::to_value` and `blocks_to_message_content` (`assistant_event.rs`), so a
  serde-derived `images` field survives.
- `build_tool_result_blocks` is shared by the live path (`user_event.rs`), history
  (`history_converters.rs`, `convert_user_entry` region) and subagent history
  (`history_subagents.rs`).
- `attach_subagent_tool_results` (`history_subagents.rs`) reconstructs `ToolResult` field by field, so it
  drops any field it does not name.
- The ACP encoder emits a result as exactly one text entry plus an optional diff:
  `result_content` in `mainframe-acp/src/encoder/result_content.rs`.
- `mainframe_types::acp::content::ContentBlock::Image { data, mime_type, uri, meta }` already exists and is
  produced for leaf images in `encoder/content.rs`.
- The TS `ToolCallContentSchema` (`packages/types/src/acp/tool-call.ts`) wraps `ContentBlockSchema`, which
  already accepts `image` (`packages/types/src/acp/content.ts`, `ImageContentBlockSchema`). No schema
  change is needed on the wire.
- The UI drops image entries today: `toolCallResult` in `convert-acp-item.ts` filters to
  `entry.content.type === 'text'`.
- `resolveResultText` (`tools/shared/result.ts`) calls `JSON.stringify`s any object that is neither
  structured nor truncated. `ToolFallbackResult` (`tool-fallback-parts.tsx`) and `MCPToolCard`'s
  `extractResultText` do the same.
- `resolveToolCard` in `tools/registry.ts` routes `mcp__*` to `MCPToolCard`. `ToolFallback` only serves
  unregistered tools (`tool-dispatch.tsx`, `MessageToolLeaf`).
- `CollapsibleCardShell` (`tools/shared/card-shell.tsx`) renders `trailing` inside `CollapsibleTrigger`
  with `disabled={disableTrigger || !hasBody}`.
- The repository's existing pattern for controls inside the trigger is a `span role="button"` plus
  `stopPropagation` (`ClickableFilePath` in `shared/chrome.tsx`, `OpenDiffButton` in `EditFileCard.tsx`).
- `ImageLightbox` (`features/chat/parts/ImageLightbox.tsx`) takes `images: LightboxImage[]`,
  `index: number | null` and `onIndexChange`.
- `AttachmentTrigger` (`components/ui/attachment.tsx`) renders a `<button>` unless `asChild` is set.
- `docs/plans/` is gitignored (`.gitignore`), so plans are committed with `git add -f`.
