/**
 * Guards the one react-lexical internal the chip field relies on: the tag its
 * `SyncPlugin` puts on runtime → editor syncs (copied in `aui-sync-tag.ts`
 * because the package does not export it). Mounts the real
 * `LexicalComposerInput` on a real external-store runtime. If an upstream
 * release renames the tag, both tests fail here, before ⌘Z after a send quietly
 * starts bringing the sent text back. The ⌘Z behaviour itself is checked in a
 * real browser by the harness (`benchmarks/lexical-chips`, "⌘Z after a send").
 */
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AssistantRuntimeProvider, useAui, useExternalStoreRuntime, type ThreadMessage } from '@assistant-ui/react';
import { LexicalComposerInput } from '@assistant-ui/react-lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  type LexicalEditor,
} from 'lexical';
import { AUI_SYNC_TAG } from '../aui-sync-tag';
import { ComposerBridgePlugin } from '../composer-lexical-plugins';
import { createLexicalComposerBridge } from '../lexical-bridge';

const NO_ARIA = {} as never;

function Probe({
  onTags,
  onReady,
}: {
  onTags(tags: Set<string>): void;
  onReady(editor: LexicalEditor, aui: ReturnType<typeof useAui>): void;
}) {
  const [editor] = useLexicalComposerContext();
  const aui = useAui();
  useEffect(() => onReady(editor, aui), [editor, aui, onReady]);
  useEffect(() => editor.registerUpdateListener(({ tags }) => onTags(new Set(tags))), [editor, onTags]);
  return null;
}

function mount(onTags: (tags: Set<string>) => void) {
  const ready: { editor?: LexicalEditor; aui?: ReturnType<typeof useAui> } = {};
  function Harness() {
    const runtime = useExternalStoreRuntime<ThreadMessage>({ isRunning: false, messages: [], onNew: async () => {} });
    return (
      <AssistantRuntimeProvider runtime={runtime}>
        <LexicalComposerInput data-testid="field" submitMode="none">
          <ComposerBridgePlugin bridge={createLexicalComposerBridge()} aria={NO_ARIA} />
          <Probe
            onTags={onTags}
            onReady={(editor, aui) => {
              ready.editor = editor;
              ready.aui = aui;
            }}
          />
        </LexicalComposerInput>
      </AssistantRuntimeProvider>
    );
  }
  render(<Harness />);
  return ready;
}

const editorText = (editor: LexicalEditor) => editor.getEditorState().read(() => $getRoot().getTextContent());

describe('react-lexical runtime sync tag', () => {
  it('tags a runtime → editor sync with the tag aui-sync-tag.ts copies', async () => {
    const seen: Set<string>[] = [];
    const ready = mount((tags) => seen.push(tags));
    await screen.findByTestId('field');
    await waitFor(() => expect(ready.aui).toBeDefined());

    act(() => ready.aui!.composer.setText('from the runtime'));

    await waitFor(() => expect(editorText(ready.editor!)).toBe('from the runtime'));
    expect(seen.some((tags) => tags.has(AUI_SYNC_TAG))).toBe(true);
  });

  it('clears the undo history when the runtime empties the field (a send), and not when the user does', async () => {
    const ready = mount(() => {});
    await waitFor(() => expect(ready.editor).toBeDefined());
    const editor = ready.editor!;
    const clears = vi.fn(() => false);
    editor.registerCommand(CLEAR_HISTORY_COMMAND, clears, COMMAND_PRIORITY_CRITICAL);
    const typeText = (text: string) =>
      act(() => {
        editor.update(
          () => {
            $getRoot().selectEnd();
            const selection = $getSelection();
            if ($isRangeSelection(selection)) selection.insertText(text);
          },
          { discrete: true },
        );
      });

    typeText('typed');
    act(() => {
      editor.update(() => $getRoot().clear().append($createParagraphNode()), { discrete: true });
    });
    expect(clears).not.toHaveBeenCalled();

    typeText('sent text');
    await waitFor(() => expect(ready.aui!.composer.getState().text).toBe('sent text'));
    act(() => ready.aui!.composer.setText(''));

    await waitFor(() => expect(editorText(editor)).toBe(''));
    expect(clears).toHaveBeenCalledTimes(1);
  });
});
