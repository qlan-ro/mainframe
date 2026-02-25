# Diff View Commenting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add inline commenting to the Monaco diff editor so users can comment on any line, sending a chat message that auto-resumes or creates a session.

**Architecture:** Extract shared `InlineCommentWidget`, add glyph margin handlers to `MonacoDiffEditor`'s modified editor, wire through `DiffTab` and `EditorTab` with a shared `sendCommentMessage` helper that resolves the target chat (existing → active → create new).

**Tech Stack:** React, Monaco Editor (`@monaco-editor/react`), Zustand, TypeScript

---

### Task 1: Extract `InlineCommentWidget` to shared file

**Files:**
- Create: `packages/desktop/src/renderer/components/editor/InlineCommentWidget.tsx`
- Modify: `packages/desktop/src/renderer/components/editor/MonacoEditor.tsx:1-80`

**Step 1: Create `InlineCommentWidget.tsx`**

Extract lines 1-80 from `MonacoEditor.tsx` into a new file. Export the component and the `InlineCommentState` interface.

```tsx
// InlineCommentWidget.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';

export interface InlineCommentState {
  line: number;
  lineContent: string;
  top: number;
}

export function InlineCommentWidget({
  line,
  lineContent,
  onSubmit,
  onClose,
}: {
  line: number;
  lineContent: string;
  onSubmit: (comment: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (!text.trim()) return;
    onSubmit(text.trim());
  };

  return (
    <div className="pl-2 pr-4 py-1">
      <div className="text-mf-small font-mono text-mf-text-secondary truncate opacity-60 mb-1">
        L{line}: {lineContent.trim()}
      </div>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
          }
          if (e.key === 'Escape') onClose();
        }}
        placeholder="Add context about this line..."
        className="w-full h-[54px] resize-none bg-mf-input-bg border border-mf-divider rounded-md px-3 py-2 text-[13px] font-mono text-mf-text-primary focus:outline-none focus:border-mf-accent/50"
      />
      <div className="flex items-center justify-between mt-1">
        <span className="text-[11px] text-mf-text-secondary opacity-40">
          {navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl'}+Enter to send
        </span>
        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-mf-small text-mf-accent hover:bg-mf-accent/10 disabled:opacity-30 transition-colors"
        >
          <Send size={11} />
          Send
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Update `MonacoEditor.tsx` to import from shared file**

Remove lines 4, 17-80 (the `Send` import, `InlineCommentState` interface, and `InlineCommentWidget` function). Add import:

```tsx
import { InlineCommentWidget, type InlineCommentState } from './InlineCommentWidget';
```

Remove the `Send` import from lucide-react.

**Step 3: Verify typecheck**

Run: `pnpm --filter @mainframe/desktop exec tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/editor/InlineCommentWidget.tsx packages/desktop/src/renderer/components/editor/MonacoEditor.tsx
git commit -m "refactor: extract InlineCommentWidget to shared file"
```

---

### Task 2: Add comment support to `MonacoDiffEditor`

**Files:**
- Modify: `packages/desktop/src/renderer/components/editor/MonacoDiffEditor.tsx`

**Step 1: Add commenting to `MonacoDiffEditor`**

The diff editor in unified mode has a single editor surface accessible via `editor.getModifiedEditor()`. Add the same glyph margin hover/click/scroll pattern from `MonacoEditor`, plus render `InlineCommentWidget` overlay.

Key differences from `MonacoEditor`:
- Use `DiffOnMount` which gives `(editor: IStandaloneDiffEditor, monaco)` — get the inner editor via `editor.getModifiedEditor()`
- The `lineOffset` for display is already computed — pass `line + lineOffset` to the callback so the reported line matches what the user sees in the file

```tsx
import React, { useRef, useLayoutEffect, useCallback, useState } from 'react';
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';
import type * as monacoType from 'monaco-editor';
import { InlineCommentWidget, type InlineCommentState } from './InlineCommentWidget';
import './setup';

interface MonacoDiffEditorProps {
  original: string;
  modified: string;
  language?: string;
  startLine?: number;
  onLineComment?: (line: number, lineContent: string, comment: string) => void;
}

export function MonacoDiffEditor({
  original, modified, language, startLine, onLineComment,
}: MonacoDiffEditorProps): React.ReactElement {
  const lineOffset = (startLine && startLine > 1) ? startLine - 1 : 0;
  const editorRef = useRef<monacoType.editor.IStandaloneDiffEditor | null>(null);
  const decorationsRef = useRef<monacoType.editor.IEditorDecorationsCollection | null>(null);
  const zoneIdRef = useRef<string | null>(null);
  const [inlineComment, setInlineComment] = useState<InlineCommentState | null>(null);
  const onLineCommentRef = useRef(onLineComment);
  onLineCommentRef.current = onLineComment;

  const closeInlineComment = useCallback(() => {
    const diffEditor = editorRef.current;
    const id = zoneIdRef.current;
    if (diffEditor && id) {
      const inner = diffEditor.getModifiedEditor();
      inner.changeViewZones((accessor) => accessor.removeZone(id));
    }
    zoneIdRef.current = null;
    setInlineComment(null);
  }, []);

  const handleMount: DiffOnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      if (!onLineComment) return;

      const inner = editor.getModifiedEditor();
      decorationsRef.current = inner.createDecorationsCollection([]);

      inner.onMouseMove((e) => {
        const collection = decorationsRef.current;
        if (!collection) return;
        if (
          e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
          e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
          e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS
        ) {
          const lineNumber = e.target.position?.lineNumber;
          if (lineNumber) {
            collection.set([{
              range: new monaco.Range(lineNumber, 1, lineNumber, 1),
              options: { glyphMarginClassName: 'mf-line-comment-glyph' },
            }]);
            return;
          }
        }
        collection.set([]);
      });

      inner.onMouseLeave(() => {
        decorationsRef.current?.set([]);
      });

      inner.onMouseDown((e) => {
        if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
          const lineNumber = e.target.position?.lineNumber;
          if (lineNumber) {
            const model = inner.getModel();
            const lineContent = model?.getLineContent(lineNumber) ?? '';
            closeInlineComment();
            const pos = inner.getScrolledVisiblePosition({ lineNumber, column: 1 });
            if (!pos) return;
            const domNode = document.createElement('div');
            inner.changeViewZones((accessor) => {
              zoneIdRef.current = accessor.addZone({
                afterLineNumber: lineNumber,
                heightInPx: 120,
                domNode,
              });
            });
            setInlineComment({
              line: lineNumber,
              lineContent,
              top: pos.top + pos.height,
            });
          }
        }
      });

      inner.onDidScrollChange(() => {
        closeInlineComment();
      });
    },
    [onLineComment, closeInlineComment],
  );

  useLayoutEffect(() => {
    return () => {
      const editor = editorRef.current;
      if (editor) {
        const model = editor.getModel();
        editor.dispose();
        model?.original?.dispose();
        model?.modified?.dispose();
        editorRef.current = null;
      }
    };
  }, []);

  return (
    <div className="h-full relative overflow-hidden">
      <DiffEditor
        height="100%"
        language={language}
        original={original}
        modified={modified}
        theme="mainframe-dark"
        onMount={handleMount}
        keepCurrentOriginalModel
        keepCurrentModifiedModel
        options={{
          readOnly: true,
          minimap: { enabled: false },
          lineNumbersMinChars: 5,
          lineDecorationsWidth: 4,
          scrollBeyondLastLine: false,
          fontSize: 13,
          lineHeight: 20,
          fontFamily: "'JetBrains Mono', monospace",
          renderSideBySide: false,
          hideUnchangedRegions: { enabled: true },
          renderOverviewRuler: false,
          overviewRulerBorder: false,
          overviewRulerLanes: 0,
          glyphMargin: !!onLineComment,
          folding: false,
          renderIndicators: false,
          ignoreTrimWhitespace: true,
          scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
          padding: { top: 4, bottom: 4 },
          ...(lineOffset > 0 ? { lineNumbers: (n: number) => String(n + lineOffset) } : {}),
        }}
      />
      {inlineComment && (
        <div className="absolute left-0 right-0 z-50 px-14" style={{ top: inlineComment.top }}>
          <InlineCommentWidget
            line={inlineComment.line + lineOffset}
            lineContent={inlineComment.lineContent}
            onSubmit={(comment) => {
              onLineCommentRef.current?.(
                inlineComment.line + lineOffset,
                inlineComment.lineContent,
                comment,
              );
              closeInlineComment();
            }}
            onClose={closeInlineComment}
          />
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify typecheck**

Run: `pnpm --filter @mainframe/desktop exec tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/editor/MonacoDiffEditor.tsx
git commit -m "feat: add inline commenting to MonacoDiffEditor"
```

---

### Task 3: Create `sendCommentMessage` helper

**Files:**
- Create: `packages/desktop/src/renderer/lib/send-comment-message.ts`

**Step 1: Write the helper**

This helper resolves the target chat and sends the formatted message. Shared by both `DiffTab` and `EditorTab`.

```ts
import { daemonClient } from './client';
import { useChatsStore } from '../store/chats';
import { useProjectsStore } from '../store/projects';

/**
 * Send a comment message to the best available chat.
 * Resolution: explicitChatId → activeChatId → create new chat.
 * Ensures the session is resumed before sending.
 */
export function sendCommentMessage(formatted: string, explicitChatId?: string): void {
  const chatId = explicitChatId ?? useChatsStore.getState().activeChatId;

  if (chatId) {
    ensureResumedAndSend(chatId, formatted);
    return;
  }

  // No chat exists — create one and queue the message
  const projectId = useProjectsStore.getState().activeProjectId;
  if (!projectId) return;

  const timeout = setTimeout(() => {
    unsub();
    console.warn('[sendCommentMessage] timed out waiting for chat.created');
  }, 5000);

  const unsub = useChatsStore.subscribe((state, prev) => {
    if (state.chats.length > prev.chats.length) {
      const newChat = state.chats.find((c) => !prev.chats.some((p) => p.id === c.id));
      if (newChat) {
        clearTimeout(timeout);
        unsub();
        ensureResumedAndSend(newChat.id, formatted);
      }
    }
  });

  daemonClient.createChat(projectId, 'claude');
}

function ensureResumedAndSend(chatId: string, content: string): void {
  const process = useChatsStore.getState().processes.get(chatId);
  if (!process || process.status === 'stopped') {
    daemonClient.resumeChat(chatId);
  }
  daemonClient.sendMessage(chatId, content);
}
```

**Step 2: Verify typecheck**

Run: `pnpm --filter @mainframe/desktop exec tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/lib/send-comment-message.ts
git commit -m "feat: add sendCommentMessage helper with auto-resume/create"
```

---

### Task 4: Wire `DiffTab` to pass `onLineComment`

**Files:**
- Modify: `packages/desktop/src/renderer/components/center/DiffTab.tsx`

**Step 1: Add handler**

```tsx
import { useCallback } from 'react';
import { sendCommentMessage } from '../../lib/send-comment-message';

// Inside DiffTab component:
const handleLineComment = useCallback(
  (line: number, lineContent: string, comment: string) => {
    const shortPath = filePath.split('/').slice(-3).join('/');
    const trimmedLine = lineContent.trim();
    const quote = trimmedLine ? `\n> ${trimmedLine}` : '';
    const formatted = `In diff of \`${shortPath}\` at line ${line}:${quote}\n\n${comment}`;
    sendCommentMessage(formatted, chatId);
  },
  [filePath, chatId],
);

// Pass to MonacoDiffEditor:
<MonacoDiffEditor
  ...
  onLineComment={handleLineComment}
/>
```

**Step 2: Verify typecheck**

Run: `pnpm --filter @mainframe/desktop exec tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/center/DiffTab.tsx
git commit -m "feat: wire diff view commenting through DiffTab"
```

---

### Task 5: Update `EditorTab` to use `sendCommentMessage`

**Files:**
- Modify: `packages/desktop/src/renderer/components/center/EditorTab.tsx:50-60`

**Step 1: Replace the handler**

Replace the current `handleLineComment` (which silently drops when no chatId) with:

```tsx
import { sendCommentMessage } from '../../lib/send-comment-message';

const handleLineComment = useCallback(
  (line: number, lineContent: string, comment: string) => {
    const shortPath = filePath.split('/').slice(-3).join('/');
    const trimmedLine = lineContent.trim();
    const formatted = `In \`${shortPath}\` at line ${line}:\n> ${trimmedLine}\n\n${comment}`;
    sendCommentMessage(formatted);
  },
  [filePath],
);
```

Remove unused imports: `useChatsStore`, `daemonClient`.

**Step 2: Verify typecheck**

Run: `pnpm --filter @mainframe/desktop exec tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/center/EditorTab.tsx
git commit -m "fix: EditorTab comments auto-create session when none active"
```

---

### Task 6: Final typecheck and cleanup

**Step 1: Full typecheck**

Run: `pnpm --filter @mainframe/desktop exec tsc --noEmit`
Expected: PASS

**Step 2: Verify no unused imports or dead code**

Check that `MonacoEditor.tsx` no longer imports `Send` from lucide-react, and `EditorTab.tsx` no longer imports `useChatsStore` or `daemonClient`.

**Step 3: Commit if any cleanup needed**
