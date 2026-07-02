/**
 * ComposerEditMode — muted config-toolbar treatment while editing a queued message.
 *
 * Design (03-content.jsx:759-761): the config-chip row is shown at opacity 0.4
 * AND filter: saturate(0.6) with pointer-events none while editing, so colored
 * controls (amber Plan toggle, accent-active Features/Worktree dots) visibly
 * desaturate as well as dim. Parity finding 8.7 (2026-07-02-design-parity-drift-audit.md §8).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../runtime/use-chat-thread-runtime', () => ({
  useChatExtras: () => undefined,
}));

vi.mock('../../config-toolbar/ComposerToolbar', () => ({
  ComposerToolbar: () => null,
}));

import { ComposerEditMode } from '../ComposerEditMode';
import type { QueuedEdit } from '../composer-edit-context';

const EDIT: QueuedEdit = { messageId: 'm1', content: 'hello' };

describe('ComposerEditMode — muted toolbar desaturates as well as dims', () => {
  it('toolbar wrapper has opacity-40 (not opacity-50)', () => {
    render(<ComposerEditMode edit={EDIT} onDone={vi.fn()} />);
    const wrapper = screen.getByTestId('chat-composer-edit-toolbar');
    expect(wrapper.className).toContain('opacity-40');
    expect(wrapper.className).not.toContain('opacity-50');
  });

  it('toolbar wrapper has a saturate filter class', () => {
    render(<ComposerEditMode edit={EDIT} onDone={vi.fn()} />);
    const wrapper = screen.getByTestId('chat-composer-edit-toolbar');
    expect(wrapper.className).toMatch(/saturate-\[0\.6\]/);
  });

  it('toolbar wrapper still has pointer-events-none', () => {
    render(<ComposerEditMode edit={EDIT} onDone={vi.fn()} />);
    const wrapper = screen.getByTestId('chat-composer-edit-toolbar');
    expect(wrapper.className).toContain('pointer-events-none');
  });
});
