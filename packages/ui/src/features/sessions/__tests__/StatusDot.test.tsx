/**
 * StatusDot — unit tests.
 *
 * D15: the row's leading status-only glyph (the provider mark moved to the
 * end of the meta line): `primary` spinner while working, a pulsing
 * `primary` dot while waiting (including a waiting side chat, which the
 * badge already folds into 'waiting'), a solid `primary` dot for idle+unread,
 * a `muted-foreground` ring for plain idle, and a `warning` ring for a
 * worktree- or transcript-missing session.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { SessionBadge } from '@/features/sessions/view-model/session-status';
import { StatusDot } from '../StatusDot';

function renderDot(badge: SessionBadge) {
  render(
    <TooltipProvider>
      <StatusDot badge={badge} />
    </TooltipProvider>,
  );
  return screen.getByTestId('sessions-row-status-dot');
}

describe.each<[string, SessionBadge, string]>([
  ['working', { base: 'working', unread: false }, 'primary spinner'],
  ['waiting', { base: 'waiting', unread: false }, 'pulsing primary dot'],
  ['idle + unread', { base: 'idle', unread: true }, 'solid primary dot'],
  ['idle', { base: 'idle', unread: false }, 'muted-foreground ring'],
  ['worktree-missing', { base: 'worktree-missing', unread: false }, 'warning ring'],
  ['transcript-missing', { base: 'transcript-missing', unread: false }, 'warning ring'],
])('StatusDot — %s (%s)', (_label, badge) => {
  it(`carries data-status="${badge.base}"`, () => {
    const dot = renderDot(badge);
    expect(dot).toHaveAttribute('data-status', badge.base);
  });
});

describe('StatusDot — glyph per state', () => {
  it('spins a primary loader while working', () => {
    const dot = renderDot({ base: 'working', unread: false });
    expect(dot.querySelector('.animate-spin.text-primary')).toBeTruthy();
  });

  it('pulses a filled primary dot while waiting', () => {
    const dot = renderDot({ base: 'waiting', unread: false });
    const glyph = dot.querySelector('span[aria-hidden]');
    expect(glyph?.className).toContain('animate-pulse');
    expect(glyph?.className).toContain('bg-primary');
  });

  it('fills a solid primary dot for idle + unread', () => {
    const dot = renderDot({ base: 'idle', unread: true });
    const glyph = dot.querySelector('span[aria-hidden]');
    expect(glyph?.className).toContain('bg-primary');
    expect(glyph?.className).not.toContain('animate-pulse');
  });

  it('rings muted-foreground for plain idle', () => {
    const dot = renderDot({ base: 'idle', unread: false });
    const glyph = dot.querySelector('span[aria-hidden]');
    expect(glyph?.className).toContain('border-muted-foreground');
  });

  it('rings warning for a worktree-missing session', () => {
    const dot = renderDot({ base: 'worktree-missing', unread: false });
    const glyph = dot.querySelector('span[aria-hidden]');
    expect(glyph?.className).toContain('border-warning');
  });

  it('rings warning for a transcript-missing session', () => {
    const dot = renderDot({ base: 'transcript-missing', unread: false });
    const glyph = dot.querySelector('span[aria-hidden]');
    expect(glyph?.className).toContain('border-warning');
  });
});

describe('StatusDot — labels', () => {
  it('names "Your turn" while waiting, via the accessible hint', async () => {
    renderDot({ base: 'waiting', unread: false });
    expect(screen.getByTestId('sessions-row-status-dot')).toHaveAttribute('aria-label', 'waiting');
  });

  it('carries data-unread only for an unread idle row', () => {
    const unread = renderDot({ base: 'idle', unread: true });
    expect(unread).toHaveAttribute('data-unread', 'true');
  });

  it('carries no data-unread when not unread', () => {
    const notUnread = renderDot({ base: 'idle', unread: false });
    expect(notUnread).not.toHaveAttribute('data-unread');
  });
});
