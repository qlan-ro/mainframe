/**
 * QueuedUserTurn — behavior tests for FIFO position labels and QueuedAction
 * hover-border + slide-in animation.
 *
 * Strategy:
 *  - Mock runtime hooks (useChatExtras / useComposerEdit) so the component
 *    renders without a full provider tree.
 *  - All expected class names are hardcoded — no component logic is recomputed.
 *
 * Behaviors covered:
 *  P1 — position=1, total=1 (default) → "Claude will pick this up shortly"
 *  P2 — position=1, total=3          → "Claude will pick this up shortly"
 *  P3 — position=2, total=3          → "2nd in line"
 *  P4 — position=3, total=3          → "3rd in line"
 *  P5 — position=4, total=4          → "4th in line"
 *  S1 — bubble ghost treatment       → dashed border class present, opacity-[0.82]
 *  A1 — QueuedAction has ghost border classes (border + border-transparent + hover:border-border)
 *  A2 — actions container has translate-x slide-in classes
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Stable spy refs shared across tests
// ---------------------------------------------------------------------------

const cancelQueued = vi.fn().mockResolvedValue(undefined);
const startEdit = vi.fn();

beforeEach(() => {
  cancelQueued.mockClear();
  startEdit.mockClear();
});

// ---------------------------------------------------------------------------
// Mock runtime hooks
// ---------------------------------------------------------------------------

vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useChatExtras: () => ({ cancelQueued }),
}));

vi.mock('../../composer/edit/composer-edit-context', () => ({
  useComposerEdit: () => ({ startEdit }),
}));

import { QueuedUserTurn } from '../QueuedUserTurn';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderQueued({
  content = 'hello world',
  position,
  total,
  extrasSlot,
}: {
  content?: string;
  position?: number;
  total?: number;
  extrasSlot?: ReactNode;
} = {}) {
  return render(
    <QueuedUserTurn messageId="m1" content={content} position={position} total={total} extrasSlot={extrasSlot}>
      {content}
    </QueuedUserTurn>,
  );
}

// ---------------------------------------------------------------------------
// P1-P5 — FIFO position label text across the queue-length/position matrix
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — position/total label text', () => {
  it.each([
    ['P1: default position/total (single item)', undefined, undefined, /Claude will pick this up shortly/],
    ['P2: head of a 3-item queue', 1, 3, /Claude will pick this up shortly/],
    ['P3: second of 3', 2, 3, /2nd in line/],
    ['P4: third of 3', 3, 3, /3rd in line/],
    ['P5: fourth of 4 (th suffix)', 4, 4, /4th in line/],
  ])('%s', (_label, position, total, expected) => {
    renderQueued({ position, total });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Q1 — root carries a per-message data-queued-id (every queued turn otherwise
// shares the same chat-queued-message testid, so tests must disambiguate by
// content instead of a stable id)
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — Q1: root data-queued-id', () => {
  it('sets data-queued-id to the messageId on the chat-queued-message root', () => {
    renderQueued({ content: 'hello world' });
    expect(screen.getByTestId('chat-queued-message')).toHaveAttribute('data-queued-id', 'm1');
  });
});

// ---------------------------------------------------------------------------
// S1/A1/AG/A2 — hover-reveal ghost treatment (bubble, action buttons, row gap,
// slide-in animation) all present on one render (presence matrix, not 6 renders)
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — hover-reveal ghost treatment', () => {
  it('bubble, Edit/Cancel actions, action-row gap, and slide-in classes are all present', () => {
    const { container } = renderQueued({ content: 'some text' });

    // S1 — bubble ghost treatment: dashed border + opacity
    const bubble = container.querySelector('.border-dashed');
    expect(bubble).toBeInTheDocument();
    expect(bubble!.className).toContain('opacity-[0.82]');

    // A1 — QueuedAction ghost border classes (+ Edit-specific gap/radius)
    const editBtn = screen.getByTestId('chat-queued-edit');
    expect(editBtn.className).toContain('border');
    expect(editBtn.className).toContain('border-transparent');
    expect(editBtn.className).toContain('gap-[4px]');
    expect(editBtn.className).toContain('rounded-[7px]');

    const cancelBtn = screen.getByTestId('chat-queued-cancel');
    expect(cancelBtn.className).toContain('border');
    expect(cancelBtn.className).toContain('border-transparent');

    // A2 — actions container has slide-in translate-x classes
    const actionsDiv = editBtn.parentElement;
    expect(actionsDiv).not.toBeNull();
    expect(actionsDiv!.className).toContain('translate-x-[6px]');
    expect(actionsDiv!.className).toContain('group-hover/queued:translate-x-0');

    // AG — action-row-to-bubble gap matches the design (7.6)
    const row = actionsDiv?.parentElement;
    expect(row).not.toBeNull();
    expect(row!.className).toContain('gap-4');
  });
});

// ---------------------------------------------------------------------------
// C1 — Edit and Cancel visible on capture-only (no text body) queued messages
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — C1: capture-only queued message (no text body)', () => {
  it('renders both chat-queued-edit and chat-queued-cancel when content is empty', () => {
    render(
      <QueuedUserTurn messageId="m1" content="" extrasSlot={<div data-testid="cap" />}>
        {null}
      </QueuedUserTurn>,
    );
    expect(screen.getByTestId('chat-queued-edit')).toBeInTheDocument();
    expect(screen.getByTestId('chat-queued-cancel')).toBeInTheDocument();
  });

  it('clicking Edit fires startEdit with messageId and empty content', () => {
    render(
      <QueuedUserTurn messageId="m1" content="" extrasSlot={<div data-testid="cap" />}>
        {null}
      </QueuedUserTurn>,
    );
    fireEvent.click(screen.getByTestId('chat-queued-edit'));
    expect(startEdit).toHaveBeenCalledWith({ messageId: 'm1', content: '' });
  });

  it('clicking Cancel fires cancelQueued with the messageId', () => {
    render(
      <QueuedUserTurn messageId="m1" content="" extrasSlot={<div data-testid="cap" />}>
        {null}
      </QueuedUserTurn>,
    );
    fireEvent.click(screen.getByTestId('chat-queued-cancel'));
    expect(cancelQueued).toHaveBeenCalledWith('m1');
  });
});

// ---------------------------------------------------------------------------
// C2 — Edit and Cancel still appear for a text queued message
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — C2: text queued message still shows both actions', () => {
  it('renders both chat-queued-edit and chat-queued-cancel when content is non-empty', () => {
    renderQueued({ content: 'hello world' });
    expect(screen.getByTestId('chat-queued-edit')).toBeInTheDocument();
    expect(screen.getByTestId('chat-queued-cancel')).toBeInTheDocument();
  });

  it('clicking Edit fires startEdit with the text content', () => {
    renderQueued({ content: 'hello world' });
    fireEvent.click(screen.getByTestId('chat-queued-edit'));
    expect(startEdit).toHaveBeenCalledWith({ messageId: 'm1', content: 'hello world' });
  });
});
