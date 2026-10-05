/**
 * AutomationSidebarRow — unit tests.
 *
 * D23: one 36px row — trigger glyph, name, a status dot (running `primary`
 * pulsing / needs-you `warning` / disabled muted / idle plain), and the
 * compact last-run time. Click opens the automation's details.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { AutomationRowVm } from '../automation-row-view';
import { AutomationSidebarRow } from '../AutomationSidebarRow';

function row(over: Partial<AutomationRowVm> = {}): AutomationRowVm {
  return { id: 'auto-1', name: 'Deploy on merge', trigger: 'schedule', status: 'idle', lastRunAt: null, ...over };
}

function renderRow(r: AutomationRowVm, now = Date.now(), onOpen = vi.fn()) {
  render(
    <TooltipProvider>
      <AutomationSidebarRow row={r} now={now} onOpen={onOpen} />
    </TooltipProvider>,
  );
  return onOpen;
}

describe('AutomationSidebarRow — content', () => {
  it('shows the automation name', () => {
    renderRow(row({ name: 'Nightly backup' }));
    expect(screen.getByTestId('automations-sidebar-row-auto-1')).toHaveTextContent('Nightly backup');
  });

  it('shows "—" when it never ran', () => {
    renderRow(row({ lastRunAt: null }));
    expect(screen.getByTestId('automations-sidebar-row-auto-1')).toHaveTextContent('—');
  });

  it('shows the compact last-run time when it has run', () => {
    const now = 10 * 60_000;
    renderRow(row({ lastRunAt: 5 * 60_000 }), now);
    expect(screen.getByTestId('automations-sidebar-row-auto-1')).toHaveTextContent('5m');
  });
});

describe('AutomationSidebarRow — status dot', () => {
  it('pulses primary while running', () => {
    renderRow(row({ status: 'running' }));
    const dot = screen.getByTestId('automations-sidebar-row-status');
    expect(dot).toHaveAttribute('data-status', 'running');
    expect(dot.className).toContain('animate-pulse');
    expect(dot.className).toContain('bg-primary');
  });

  it('is warning while needing you', () => {
    renderRow(row({ status: 'needs-you' }));
    const dot = screen.getByTestId('automations-sidebar-row-status');
    expect(dot.className).toContain('bg-warning');
  });

  it('is a muted ring while disabled, and dims the row text', () => {
    renderRow(row({ status: 'disabled' }));
    const dot = screen.getByTestId('automations-sidebar-row-status');
    expect(dot.className).toContain('border-muted-foreground');
    expect(screen.getByTestId('automations-sidebar-row-auto-1').className).toContain('text-muted-foreground');
  });

  it('is a plain muted fill while idle', () => {
    renderRow(row({ status: 'idle' }));
    const dot = screen.getByTestId('automations-sidebar-row-status');
    expect(dot.className).toContain('bg-muted-foreground/50');
    expect(dot.className).not.toContain('animate-pulse');
  });
});

describe('AutomationSidebarRow — click', () => {
  it('calls onOpen', () => {
    const onOpen = renderRow(row());
    fireEvent.click(screen.getByTestId('automations-sidebar-row-auto-1'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('AutomationSidebarRow — selected state (2026-10 redesign)', () => {
  it('is unselected by default', () => {
    render(
      <TooltipProvider>
        <AutomationSidebarRow row={row()} now={Date.now()} onOpen={vi.fn()} />
      </TooltipProvider>,
    );
    const el = screen.getByTestId('automations-sidebar-row-auto-1');
    expect(el).toHaveAttribute('aria-pressed', 'false');
    expect(el.className).not.toContain('bg-sidebar-selection');
  });

  it('highlights like the session rows when selected', () => {
    render(
      <TooltipProvider>
        <AutomationSidebarRow row={row()} now={Date.now()} selected onOpen={vi.fn()} />
      </TooltipProvider>,
    );
    const el = screen.getByTestId('automations-sidebar-row-auto-1');
    expect(el).toHaveAttribute('aria-pressed', 'true');
    expect(el.className).toContain('bg-sidebar-selection');
  });
});
