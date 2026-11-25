/** A draft's captures and code annotations as tiles (C14): what they say, and what their controls do. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: unknown) => unknown) => sel({ threadListItem: { id: 't1' } }),
  ComposerPrimitive: { Attachments: () => null },
  AttachmentPrimitive: { Remove: ({ children }: { children: React.ReactNode }) => <>{children}</> },
}));

import { ComposerAttachments } from '../../attachments/ComposerAttachmentStrip';
import { draftItemsOf, useDraftContent, type NewDraftItem } from '../draft-content-store';

const ELEMENT: NewDraftItem = {
  kind: 'capture',
  type: 'element',
  imageDataUrl: 'data:image/png;base64,AAAA',
  selector: '.capsule .reset',
  note: 'Show the next reset',
};
const REGION: NewDraftItem = {
  kind: 'capture',
  type: 'screenshot',
  imageDataUrl: 'data:image/png;base64,BBBB',
  region: { w: 640.4, h: 180 },
  note: '',
};
const CODE: NewDraftItem = {
  kind: 'code',
  filePath: 'crates/quota/src/codex.rs',
  startLine: 32,
  endLine: 38,
  lineContent: 'x',
  note: 'Keep resets_at',
};

const add = (...items: NewDraftItem[]) => useDraftContent.getState().add('t1', items);
const notes = () => draftItemsOf('t1').map((item) => item.note);

function strip() {
  return render(
    <TooltipProvider>
      <div data-testid="chat-composer">
        <ComposerAttachments />
        <textarea data-testid="chat-composer-input" />
      </div>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  useDraftContent.setState({ byThread: {} });
});

describe('tiles', () => {
  it('say what an element, a region and code lines are', () => {
    add(ELEMENT, REGION, CODE);
    strip();
    const [element, region] = screen.getAllByTestId('composer-capture-tile');
    expect(element).toHaveTextContent('Show the next reset');
    expect(element).toHaveTextContent('element1 · .capsule .reset');
    expect(element!.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(region).toHaveTextContent('screenshot1 · Region 640×180');
    const code = screen.getByTestId('composer-code-tile');
    expect(code).toHaveTextContent('Keep resets_at');
    expect(code).toHaveTextContent('codex.rs:32–38');
    expect(code).toHaveTextContent('rs');
  });

  it('name one line as one line', () => {
    add({ ...CODE, endLine: 32 } as NewDraftItem);
    strip();
    expect(screen.getByText('codex.rs:32')).toBeInTheDocument();
  });

  it('show the whole note, path and lines in the tooltip', async () => {
    add(CODE);
    strip();
    fireEvent.focus(screen.getByTestId('composer-draft-item-remove'));
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Keep resets_at · crates/quota/src/codex.rs:32–38');
  });

  it('remove the one they belong to, and number the rest again', () => {
    add(ELEMENT, { ...ELEMENT, note: 'second' } as NewDraftItem);
    strip();
    fireEvent.click(screen.getByRole('button', { name: 'Remove element1' }));
    expect(notes()).toEqual(['second']);
    expect(screen.getByTestId('composer-capture-tile')).toHaveTextContent('element1');
  });

  it('keeps the last of 50 captures reachable by its accessible controls', async () => {
    const user = userEvent.setup();
    add(...Array.from({ length: 50 }, () => REGION));
    strip();

    expect(screen.getAllByTestId('composer-capture-tile')).toHaveLength(50);
    const addNote = screen.getByRole('button', { name: 'Add a note on screenshot50' });
    addNote.focus();
    await user.keyboard('{Enter}');
    const note = await screen.findByTestId('composer-note-input');
    expect(note).toHaveFocus();
    await user.keyboard('Last capture{Escape}');
    await waitFor(() => expect(screen.queryByTestId('composer-note-input')).toBeNull());
    expect(notes().at(-1)).toBe('Last capture');

    const remove = screen.getByRole('button', { name: 'Remove screenshot50' });
    remove.focus();
    await user.keyboard('{Enter}');
    expect(screen.getAllByTestId('composer-capture-tile')).toHaveLength(49);
  });

  it('take no room when the draft has none', () => {
    strip();
    expect(screen.getByTestId('composer-attachments')).toBeEmptyDOMElement();
  });
});

describe('notes', () => {
  it('are added from the tile, and the editor stays open while they are typed', async () => {
    add(REGION);
    strip();
    fireEvent.click(screen.getByRole('button', { name: 'Add a note on screenshot1' }));
    const input = await screen.findByTestId('composer-note-input');
    fireEvent.change(input, { target: { value: 'T' } });
    expect(screen.getByTestId('composer-note-input')).toBe(input);
    fireEvent.change(input, { target: { value: 'Too wide' } });
    expect(notes()).toEqual(['Too wide']);
    expect(screen.getByTestId('composer-capture-tile')).toHaveTextContent('Too wide');
  });

  it('are edited from the pencil', async () => {
    add(CODE);
    strip();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the note on codex.rs:32–38' }));
    const input = await screen.findByTestId('composer-note-input');
    expect(input).toHaveValue('Keep resets_at');
    fireEvent.change(input, { target: { value: 'Keep both' } });
    expect(notes()).toEqual(['Keep both']);
  });

  it('survive Escape, and focus goes back to the control', async () => {
    add(CODE);
    strip();
    fireEvent.click(screen.getByTestId('composer-note-edit'));
    const input = await screen.findByTestId('composer-note-input');
    fireEvent.change(input, { target: { value: 'half a thou' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('composer-note-input')).toBeNull());
    expect(notes()).toEqual(['half a thou']);
    expect(screen.getByTestId('composer-note-edit')).toHaveFocus();
  });

  it('close on Enter, not on a new line', async () => {
    add(CODE);
    strip();
    fireEvent.click(screen.getByTestId('composer-note-edit'));
    const input = await screen.findByTestId('composer-note-input');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(screen.getByTestId('composer-note-input')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByTestId('composer-note-input')).toBeNull());
  });

  it('emptied again, offer to add one', async () => {
    add(CODE);
    strip();
    fireEvent.click(screen.getByTestId('composer-note-edit'));
    fireEvent.change(await screen.findByTestId('composer-note-input'), { target: { value: '  ' } });
    expect(within(screen.getByTestId('composer-code-tile')).getByText('Add a note')).toBeInTheDocument();
    expect(screen.getByTestId('composer-note-input')).toHaveValue('  ');
  });
});

describe('a tile from the workspace', () => {
  it('brings the caret to its composer’s field', () => {
    strip();
    act(() => add(CODE));
    expect(screen.getByTestId('chat-composer-input')).toHaveFocus();
  });

  it('does not when one is removed, edited, or was there already', () => {
    add(CODE, ELEMENT);
    strip();
    expect(screen.getByTestId('chat-composer-input')).not.toHaveFocus();
    act(() => useDraftContent.getState().setNote('t1', draftItemsOf('t1')[0]!.id, 'x'));
    act(() => useDraftContent.getState().remove('t1', draftItemsOf('t1')[0]!.id));
    expect(screen.getByTestId('chat-composer-input')).not.toHaveFocus();
  });
});
