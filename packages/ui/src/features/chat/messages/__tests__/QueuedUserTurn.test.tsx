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
 *  P1 — position=1, total=1 (default) → "sends after the current run"
 *  P2 — position=1, total=3          → "sends next, after the current run"
 *  P3 — position=2, total=3          → "2nd to send"
 *  P4 — position=3, total=3          → "3rd to send"
 *  P5 — position=4, total=4          → "4th to send"
 *  S1 — sending=false (default)      → dashed border class present, opacity-[0.82]
 *  S2 — sending=true                 → border-solid class (no dashed), 'Sending now…', no opacity-[0.82]
 *  A1 — QueuedAction has ghost border classes (border + border-transparent + hover:border-border)
 *  A2 — actions container has translate-x slide-in classes
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Mock runtime hooks
// ---------------------------------------------------------------------------

vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useChatExtras: () => ({
    cancelQueued: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../composer/edit/composer-edit-context', () => ({
  useComposerEdit: () => ({ startEdit: vi.fn() }),
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
    expect(screen.getByText(/sends after the current run/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// P2 — first of multiple: "sends next"
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — P2: head of multi-item queue', () => {
  it('renders "sends next, after the current run" for position=1 total=3', () => {
    renderQueued({ position: 1, total: 3 });
    expect(screen.getByText(/sends next, after the current run/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// P3 — second item in queue
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — P3: second in queue', () => {
  it('renders "2nd to send" for position=2 total=3', () => {
    renderQueued({ position: 2, total: 3 });
    expect(screen.getByText(/2nd to send/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// P4 — third item in queue
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — P4: third in queue', () => {
  it('renders "3rd to send" for position=3 total=3', () => {
    renderQueued({ position: 3, total: 3 });
    expect(screen.getByText(/3rd to send/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// P5 — fourth item (cardinal suffix "th")
// ---------------------------------------------------------------------------

describe('QueuedUserTurn — P5: fourth in queue uses "th" suffix', () => {
  it('renders "4th to send" for position=4 total=4', () => {
    renderQueued({ position: 4, total: 4 });
    expect(screen.getByText(/4th to send/)).toBeInTheDocument();
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
