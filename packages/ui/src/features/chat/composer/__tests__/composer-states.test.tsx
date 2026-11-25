/**
 * Composer visual-state behavior tests — Phase 3 parity fixes.
 *
 * Covers:
 *  1. PermissionSelect per-option description notes
 *
 * Each test asserts hardcoded expected values against the rendered DOM —
 * never derives expectations from the component's own logic.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Subject imports
// ---------------------------------------------------------------------------

import { PermissionSelect } from '../config-toolbar/PermissionSelect';
import type { Chat } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    adapterId: 'claude',
    projectId: 'proj-1',
    status: 'active',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    temporary: false,
    noProject: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. PermissionSelect — per-option description notes
// ---------------------------------------------------------------------------

describe('PermissionSelect — dropdown items render description notes', () => {
  it('Interactive option renders its description note "Approve every action"', async () => {
    render(
      <TooltipProvider>
        <PermissionSelect chat={makeChat()} setPermissionMode={vi.fn()} />
      </TooltipProvider>,
    );

    await userEvent.click(screen.getByTestId('composer-permission-mode-select'));

    const interactive = screen.getByTestId('composer-permission-mode-select-option-default');
    expect(interactive.textContent).toContain('Approve every action');
  });

  it('Auto-Edits option renders its description note "Edits applied, commands ask"', async () => {
    render(
      <TooltipProvider>
        <PermissionSelect chat={makeChat()} setPermissionMode={vi.fn()} />
      </TooltipProvider>,
    );

    await userEvent.click(screen.getByTestId('composer-permission-mode-select'));

    const autoEdits = screen.getByTestId('composer-permission-mode-select-option-acceptEdits');
    expect(autoEdits.textContent).toContain('Edits applied, commands ask');
  });

  it('Unattended option renders its description note "Runs without prompts"', async () => {
    render(
      <TooltipProvider>
        <PermissionSelect chat={makeChat()} setPermissionMode={vi.fn()} />
      </TooltipProvider>,
    );

    await userEvent.click(screen.getByTestId('composer-permission-mode-select'));

    const unattended = screen.getByTestId('composer-permission-mode-select-option-yolo');
    expect(unattended.textContent).toContain('Runs without prompts');
  });
});
