// @vitest-environment jsdom

/**
 * RowBody — the one-line row (L1, L3): project letter, title, then exactly one
 * trailing value. "needs you" outranks the spinner, and either takes the time's
 * place.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/session-tabs/use-tab-hint-index', () => ({ useTabHintIndex: () => null }));

import type { SessionCustom, SessionItem } from '../view-model/chat-to-thread-custom';
import { RowBody } from '../SessionRowBody';

function makeItem(custom: Partial<SessionCustom> = {}): SessionItem {
  return {
    id: 'chat-1',
    title: 'Fix the login race',
    status: 'regular',
    custom: {
      projectId: 'proj-a',
      adapterId: 'claude',
      tags: ['bug'],
      pinned: true,
      status: 'active',
      displayStatus: 'idle',
      hasPending: false,
      detectedPrs: [{ url: 'u', owner: 'o', repo: 'r', number: 1, source: 'created' }],
      worktreePath: '/wt',
      worktreeMissing: true,
      transcriptMissing: false,
      temporary: true,
      noProject: false,
      updatedAt: Date.now() - 31 * 60_000,
      ...custom,
    },
  };
}

function renderBody(item: SessionItem, props: { unread?: boolean; projectName?: string } = {}) {
  return render(
    <button type="button">
      <RowBody
        item={item}
        unread={props.unread ?? false}
        projectName={'projectName' in props ? props.projectName : 'mainframe-ui'}
        renameSlot={null}
        actionsSlot={null}
      />
    </button>,
  );
}

const status = () => screen.getByTestId('sessions-row-status');

describe('RowBody — the project letter', () => {
  it('leads with the project’s initial', () => {
    renderBody(makeItem());
    expect(screen.getByTestId('sessions-row-project-tile')).toHaveTextContent('M');
    expect(screen.getByRole('button').firstElementChild).toBe(screen.getByTestId('sessions-row-project-tile'));
  });

  it('is a dash for a chat with no project, whatever name it was handed', () => {
    renderBody(makeItem({ noProject: true }), { projectName: 'scratch' });
    expect(screen.getByTestId('sessions-row-project-tile')).toHaveTextContent('–');
  });

  it('is a dash while the project is unknown', () => {
    renderBody(makeItem(), { projectName: undefined });
    expect(screen.getByTestId('sessions-row-project-tile')).toHaveTextContent('–');
  });
});

describe('RowBody — the trailing value', () => {
  it('is the time when nothing is going on', () => {
    renderBody(makeItem());
    expect(status()).toHaveAttribute('data-status', 'idle');
    expect(screen.getByTestId('sessions-row-relative-time')).toHaveTextContent('31m');
  });

  it('is a spinner while running, in the time’s place', () => {
    renderBody(makeItem({ displayStatus: 'working' }));
    expect(status()).toHaveAttribute('data-status', 'running');
    expect(status()).toHaveTextContent('Running');
    expect(status().querySelector('svg')).toBeTruthy();
    expect(screen.queryByTestId('sessions-row-relative-time')).toBeNull();
  });

  it('is "needs you" over a running turn, without a spinner', () => {
    renderBody(makeItem({ displayStatus: 'working', delegatedWaiting: true }));
    expect(status()).toHaveAttribute('data-status', 'needs-you');
    expect(status()).toHaveTextContent('needs you');
    expect(status().querySelector('svg')).toBeNull();
  });
});

describe('RowBody — the rest of the row', () => {
  it('draws no tag, PR, worktree, pin, temporary or provider mark', () => {
    const { container } = renderBody(makeItem());
    expect(container.querySelector('svg')).toBeNull();
  });

  it('reads as title, project and status', () => {
    renderBody(makeItem({ hasPending: true }));
    expect(screen.getByRole('button')).toHaveAccessibleName(/Fix the login race.*mainframe-ui.*needs you/);
  });

  it('says in the name that the worktree or the transcript is missing', () => {
    const { unmount } = renderBody(makeItem({ worktreeMissing: true, transcriptMissing: true }));
    expect(screen.getByRole('button')).toHaveAccessibleName(/worktree missing.*transcript missing/);
    unmount();

    renderBody(makeItem({ worktreeMissing: false }));
    expect(screen.getByRole('button')).not.toHaveAccessibleName(/missing/);
  });

  it('marks an unread response on the title and in the name', () => {
    renderBody(makeItem(), { unread: true });
    expect(screen.getByTestId('sessions-row-title')).toHaveAttribute('data-unread', 'true');
    expect(screen.getByRole('button')).toHaveAccessibleName(/unread/);
  });
});
