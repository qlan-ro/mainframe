# Diff View Commenting

Add inline commenting to `MonacoDiffEditor` so users can comment on any line in a unified diff. Comments send a chat message directly, starting a session if none is active.

## Approach

Extract `InlineCommentWidget` into a shared component. Add glyph margin click handlers to the diff editor's modified editor (the single surface in unified mode). Wire the comment callback through `DiffTab` with auto-resume/create session logic.

## Component Changes

### Extract `InlineCommentWidget`

Move from `MonacoEditor.tsx` to `packages/desktop/src/renderer/components/editor/InlineCommentWidget.tsx`. No functional changes — same props, same UX. Both `MonacoEditor` and `MonacoDiffEditor` import from the new location.

### `MonacoDiffEditor` additions

- New prop: `onLineComment?: (line: number, lineContent: string, comment: string) => void`
- Enable `glyphMargin: true` when callback is provided
- In `handleMount`, access the inline editor via `editor.getModifiedEditor()`
- Attach glyph margin hover decorations + click handler (same pattern as `MonacoEditor`)
- Render `InlineCommentWidget` as absolute overlay positioned at ViewZone location
- Dismiss on scroll (same as `MonacoEditor`)

### `MonacoEditor` update

Import `InlineCommentWidget` from new shared location. Remove inline definition.

## Session Routing in `DiffTab`

`DiffTab` provides the `onLineComment` handler with this resolution order:

1. `chatId` prop exists (diff came from a session) → use it
2. `activeChatId` from chats store → use it
3. Neither → `daemonClient.createChat(projectId, 'claude')`, subscribe to store for `chat.created` event, send queued message to the new chat, unsubscribe

Before sending, check `processes.get(chatId)` — if no running process, call `daemonClient.resumeChat(chatId)` first.

### Same fix for `EditorTab`

`EditorTab.handleLineComment` currently drops comments silently when `activeChatId` is null. Apply the same create-and-queue logic.

## Message Format

```
In diff of `path/to/file.ts` at line {line}:
> {lineContent}

{comment}
```

- Line number includes the `startLine` offset (matches what the user sees)
- Empty line content omits the `> ` quote line

## Edge Cases

- **Line offset**: Report displayed line number (with `startLine` offset applied)
- **Rapid double-click**: `closeInlineComment()` called before opening new widget
- **Scroll dismissal**: Widget closes on scroll events
- **Create-chat timeout**: If no `chat.created` event within 5 seconds, drop the message and log a warning
