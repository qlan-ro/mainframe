/**
 * Paste into the chip field: the field's own paste plugins (files first, then
 * chips) on a real `LexicalComposerInput`, with a paste event on the editable
 * element the way the browser sends one. Plain text falls through to Lexical's
 * plain-text paste.
 */
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AssistantRuntime,
  type ThreadMessage,
} from '@assistant-ui/react';
import { LexicalComposerInput } from '@assistant-ui/react-lexical';
import { $getRoot, type LexicalEditor } from 'lexical';
import { createAttachmentAdapter } from '../../attachment-adapter';
import { chipsIn, fieldText, typeInto } from '../../__tests__/composer-field-driver';
import { ComposerChip } from '../ComposerChip';
import { ChipPastePlugin, TypedChipsPlugin } from '../chip-plugins';
import { AttachmentPastePlugin } from '../composer-lexical-plugins';
import { createComposerChipFormatter } from '../composer-chip-formatter';

const formatter = createComposerChipFormatter([]);

/** jsdom has no clipboard events; Lexical and the plugins check the class by name. */
class ClipboardEvent extends Event {
  constructor(readonly clipboardData: { getData(type: string): string; files: File[]; types: string[] }) {
    super('paste', { bubbles: true, cancelable: true });
  }
}

function Field({ onRuntime }: { onRuntime(runtime: AssistantRuntime): void }) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isRunning: false,
    messages: [],
    onNew: async () => {},
    adapters: { attachments: createAttachmentAdapter() },
  });
  useEffect(() => {
    onRuntime(runtime);
  }, [runtime, onRuntime]);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <LexicalComposerInput submitMode="none" formatter={formatter} directiveChip={ComposerChip} aria-label="Message">
        <AttachmentPastePlugin />
        <ChipPastePlugin formatter={formatter} />
        <TypedChipsPlugin formatter={formatter} />
      </LexicalComposerInput>
    </AssistantRuntimeProvider>
  );
}

async function mount() {
  let runtime: AssistantRuntime | null = null;
  const { container } = render(<Field onRuntime={(r) => (runtime = r)} />);
  const field = await waitFor(() => {
    const editable = container.querySelector<HTMLElement>('[contenteditable="true"]');
    expect(editable).not.toBeNull();
    return editable!;
  });
  await waitFor(() => expect(runtime).not.toBeNull());
  // A paste lands at the caret; jsdom never places one on its own.
  const editor = (field as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
  act(() => editor.update(() => $getRoot().selectEnd(), { discrete: true }));
  return { field, container, runtime: runtime! };
}

function paste(field: HTMLElement, { text = '', files = [] }: { text?: string; files?: File[] }): ClipboardEvent {
  const event = new ClipboardEvent({
    getData: (type) => (type === 'text/plain' ? text : ''),
    files,
    types: [...(text ? ['text/plain'] : []), ...(files.length ? ['Files'] : [])],
  });
  act(() => {
    field.dispatchEvent(event);
  });
  return event;
}

describe('paste into the chip field', () => {
  beforeEach(() => vi.stubGlobal('ClipboardEvent', ClipboardEvent));
  afterEach(() => vi.unstubAllGlobals());

  it('pastes plain text as text', async () => {
    const { field, container } = await mount();
    typeInto(field, 'see ');

    paste(field, { text: 'plain words' });

    await waitFor(() => expect(fieldText(field)).toBe('see plain words'));
    expect(chipsIn(container)).toEqual([]);
  });

  it('brings copied tokens back as chips, by the message grammar', async () => {
    const { field, container } = await mount();

    const event = paste(field, { text: '/review look at @src/app.ts and /later' });

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(fieldText(field)).toBe('/review look at @src/app.ts and /later'));
    expect(chipsIn(container)).toEqual(['/review', '@src/app.ts']);
  });

  it('keeps a /command pasted after other text as text', async () => {
    const { field, container } = await mount();
    typeInto(field, 'please ');

    paste(field, { text: '/review' });

    await waitFor(() => expect(fieldText(field)).toBe('please /review'));
    expect(chipsIn(container)).toEqual([]);
  });

  it('adds a pasted file as an attachment and leaves the text alone', async () => {
    const { field, runtime } = await mount();
    typeInto(field, 'shot ');

    const event = paste(field, {
      files: [new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' })],
    });

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(runtime.thread.composer.getState().attachments.map((attachment) => attachment.name)).toEqual(['shot.png']),
    );
    expect(fieldText(field)).toBe('shot ');
  });
});
