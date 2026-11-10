/**
 * Todo #409 — single-line labels in the left session sidebar fade (FadeLabel)
 * instead of ending in an ellipsis, and only when they actually overflow.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('@/features/sessions/new-thread/use-start-new-session', () => ({ useStartNewSession: () => () => {} }));
vi.mock('@/components/ui/hint', () => ({ Hint: ({ children }: { children: ReactNode }) => <>{children}</> }));

import { SidebarProvider, SidebarMenu } from '@/components/ui/sidebar';
import { SessionGroupHeader } from '../SessionGroupHeader';
import { DraftSessionRow } from '../DraftSessionRow';
import { NoProjectLabel } from '../NoProjectLabel';
import { NewSessionRow } from '../SessionSidebar';

function overflow(over: boolean) {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(over ? 200 : 50);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
}
afterEach(() => vi.restoreAllMocks());

function mount() {
  return render(
    <SidebarProvider>
      <SessionGroupHeader label="Today" />
      <SidebarMenu>
        <DraftSessionRow
          projectId="p1"
          projectName="P"
          selected={false}
          showProject={false}
          onSelect={() => {}}
          onDiscard={() => {}}
        />
      </SidebarMenu>
      <NewSessionRow />
      <NoProjectLabel data-testid="np" />
    </SidebarProvider>,
  );
}

function labels(c: HTMLElement) {
  return [
    screen.getByTestId('sessions-group-header-Today').querySelector('[data-slot="fade-label"]'),
    screen.getByTestId('sessions-draft-row-title'),
    screen.getByTestId('sidebar-action-new-thread').querySelector('[data-slot="fade-label"]'),
    screen.getByTestId('np').querySelector('[data-slot="fade-label"]'),
  ].map((el) => {
    expect(el, c.innerHTML).not.toBeNull();
    return el as HTMLElement;
  });
}

describe('sidebar labels fade instead of ellipsis', () => {
  it('uses FadeLabel (no truncate) and fades only on overflow', () => {
    overflow(true);
    const { container } = mount();
    for (const el of labels(container)) {
      expect(el.getAttribute('data-slot')).toBe('fade-label');
      expect(el.classList.contains('truncate')).toBe(false);
      expect(el.classList.contains('truncate-fade')).toBe(true);
    }
  });

  it('leaves a fitting label unmasked', () => {
    overflow(false);
    const { container } = mount();
    for (const el of labels(container)) expect(el.classList.contains('truncate-fade')).toBe(false);
  });
});
