/**
 * QueuedUserTurn — behavior tests for FIFO position labels, sending state,
 * and QueuedAction hover-border + slide-in animation.
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
 *  S1 — sending=false (default)      → dashed border class present, opacity-[0.82]
 *  S2 — sending=true                 → border-solid class (no dashed), 'Sending now…', no opacity-[0.82]
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
  sending,
  extrasSlot,
}: {
  content?: string;
  position?: number;
  total?: number;
  sending?: boolean;
  extrasSlot?: ReactNode;
} = {}) {
  return render(
    <QueuedUserTurn
      messageId="m1"
      content={content}
      position={position}
      total={total}
      sending={sending}
      extrasSlot={extrasSlot}
    >
      {content}
    </QueuedUserTurn>,
  );
}

// ---------------------------------------------------------------------------
// P1 — single queued item: generic label
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — P1: single item (default position/total)', () => {
  it('renders the generic queued label', () => {
    renderQueued();
    expect(screen.getByText(/Claude will pick this up shortly/)).toBeInTheDocument();
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
// P2 — first of multiple: "sends next"
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — P2: head of multi-item queue', () => {
  it('renders "Claude will pick this up shortly" for position=1 total=3', () => {
    renderQueued({ position: 1, total: 3 });
    expect(screen.getByText(/Claude will pick this up shortly/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// P3 — second item in queue
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — P3: second in queue', () => {
  it('renders "2nd in line" for position=2 total=3', () => {
    renderQueued({ position: 2, total: 3 });
    expect(screen.getByText(/2nd in line/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// P4 — third item in queue
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — P4: third in queue', () => {
  it('renders "3rd in line" for position=3 total=3', () => {
    renderQueued({ position: 3, total: 3 });
    expect(screen.getByText(/3rd in line/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// P5 — fourth item (cardinal suffix "th")
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — P5: fourth in queue uses "th" suffix', () => {
  it('renders "4th in line" for position=4 total=4', () => {
    renderQueued({ position: 4, total: 4 });
    expect(screen.getByText(/4th in line/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// S1 — default (sending=false): dashed border + opacity
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — S1: default non-sending state', () => {
  it('bubble div has border-dashed class and opacity-[0.82]', () => {
    const { container } = renderQueued({ sending: false });
    // Find the bubble: it's the div with border-dashed
    const bubble = container.querySelector('.border-dashed');
    expect(bubble).toBeInTheDocument();
    expect(bubble!.className).toContain('opacity-[0.82]');
  });
});

// ---------------------------------------------------------------------------
// S2 — sending=true: solid border, 'Sending now…', no opacity dim
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — S2: sending state', () => {
  it('renders "Sending now…" in the meta footer', () => {
    renderQueued({ sending: true });
    expect(screen.getByText(/Sending now…/)).toBeInTheDocument();
  });

  it('bubble does NOT have border-dashed when sending=true', () => {
    const { container } = renderQueued({ sending: true });
    expect(container.querySelector('.border-dashed')).not.toBeInTheDocument();
  });

  it('bubble does NOT have opacity-[0.82] when sending=true', () => {
    const { container } = renderQueued({ sending: true });
    const bubble = container.querySelector('.border-mf-um-edge');
    expect(bubble).toBeInTheDocument();
    expect(bubble!.className).not.toContain('opacity-[0.82]');
  });
});

// ---------------------------------------------------------------------------
// A1 — QueuedAction ghost border classes
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — A1: QueuedAction ghost border', () => {
  it('Edit action button has border and border-transparent classes', () => {
    renderQueued({ content: 'some text' });
    const editBtn = screen.getByTestId('chat-queued-edit');
    expect(editBtn.className).toContain('border');
    expect(editBtn.className).toContain('border-transparent');
  });

  it('Cancel action button has border and border-transparent classes', () => {
    renderQueued({ content: 'text' });
    const cancelBtn = screen.getByTestId('chat-queued-cancel');
    expect(cancelBtn.className).toContain('border');
    expect(cancelBtn.className).toContain('border-transparent');
  });

  it('Edit action has gap-[4px] (icon/label gap) and rounded-[7px] (7.10)', () => {
    renderQueued({ content: 'some text' });
    const editBtn = screen.getByTestId('chat-queued-edit');
    expect(editBtn.className).toContain('gap-[4px]');
    expect(editBtn.className).toContain('rounded-[7px]');
  });
});

// ---------------------------------------------------------------------------
// AG — action-row-to-bubble gap matches the design (7.6)
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — AG: action row to bubble gap', () => {
  it('the row wrapping the actions + bubble has gap-4 (8px)', () => {
    renderQueued({ content: 'some text' });
    const actionsDiv = screen.getByTestId('chat-queued-edit').parentElement;
    const row = actionsDiv?.parentElement;
    expect(row).not.toBeNull();
    expect(row!.className).toContain('gap-4');
  });
});

// ---------------------------------------------------------------------------
// A2 — actions container has slide-in translate-x classes
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — A2: actions container slide-in animation', () => {
  it('actions container has translate-x-[6px] and group-hover/queued:translate-x-0 classes', () => {
    renderQueued({ content: 'text' });
    // The actions container wraps Edit and Cancel buttons
    const actionsDiv = screen.getByTestId('chat-queued-edit').parentElement;
    expect(actionsDiv).not.toBeNull();
    expect(actionsDiv!.className).toContain('translate-x-[6px]');
    expect(actionsDiv!.className).toContain('group-hover/queued:translate-x-0');
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
