import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { AdapterInfo, Chat } from '@qlan-ro/mainframe-types';

const setChatTuningSpy = vi.fn();

vi.mock('../../../renderer/lib/api', () => ({
  setChatTuning: (...args: unknown[]) => setChatTuningSpy(...args),
}));

vi.mock('../../../renderer/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const updateChatSpy = vi.fn();
vi.mock('../../../renderer/store/chats', () => ({
  useChatsStore: (selector: (s: { updateChat: (chat: Chat) => void }) => unknown) =>
    selector({ updateChat: updateChatSpy }),
}));

import {
  EffortPicker,
  shouldShowEffortPicker,
} from '../../../renderer/components/chat/assistant-ui/composer/EffortPicker';

function renderWithProviders(ui: React.ReactElement) {
  return render(<TooltipPrimitive.Provider>{ui}</TooltipPrimitive.Provider>);
}

const claudeAdapter: AdapterInfo = {
  id: 'claude',
  name: 'Claude Code',
  description: '',
  installed: true,
  models: [
    { id: 'claude-opus-4-6', label: 'Opus 4.6', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  ],
};

const codexAdapter: AdapterInfo = {
  id: 'codex',
  name: 'Codex',
  description: '',
  installed: true,
  models: [{ id: 'codex-mini-latest', label: 'Mini', supportedEfforts: ['low', 'medium', 'high'] }],
};

const baseChat: Chat = {
  id: 'c1',
  adapterId: 'claude',
  projectId: 'p1',
  status: 'active',
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
  totalCost: 0,
  totalTokensInput: 0,
  totalTokensOutput: 0,
  lastContextTokensInput: 0,
};

describe('shouldShowEffortPicker', () => {
  it('shows for a model with supportedEfforts', () => {
    expect(shouldShowEffortPicker('claude', 'claude-opus-4-6', [claudeAdapter])).toBe(true);
  });

  it('hides for a model with no supportedEfforts', () => {
    expect(shouldShowEffortPicker('claude', 'claude-haiku-4-5-20251001', [claudeAdapter])).toBe(false);
  });

  it('shows for non-claude adapter when the model has supportedEfforts', () => {
    expect(shouldShowEffortPicker('codex', 'codex-mini-latest', [codexAdapter])).toBe(true);
  });

  it('hides when the adapter is not in the registry', () => {
    expect(shouldShowEffortPicker('claude', 'claude-opus-4-6', [])).toBe(false);
  });

  it('hides when the model is not in the adapter entry', () => {
    expect(shouldShowEffortPicker('claude', 'unknown-model', [claudeAdapter])).toBe(false);
  });
});

describe('EffortPicker', () => {
  beforeEach(() => {
    setChatTuningSpy.mockReset();
    setChatTuningSpy.mockResolvedValue(undefined);
    updateChatSpy.mockReset();
  });

  it('renders for a model with supportedEfforts', () => {
    renderWithProviders(<EffortPicker chat={baseChat} adapters={[claudeAdapter]} modelId="claude-opus-4-6" />);
    // Medium is the default when chat.effort is unset
    expect(screen.getByRole('button', { name: /medium/i })).toBeTruthy();
  });

  it('renders only the model supported efforts — includes xhigh and max for Opus', async () => {
    renderWithProviders(<EffortPicker chat={baseChat} adapters={[claudeAdapter]} modelId="claude-opus-4-6" />);
    const trigger = screen.getByTestId('composer-effort-select');
    await userEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Extra-high' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Maximum' })).toBeTruthy();
  });

  it('does not render for models without supportedEfforts', () => {
    const { container } = renderWithProviders(
      <EffortPicker chat={baseChat} adapters={[claudeAdapter]} modelId="claude-haiku-4-5-20251001" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders for non-claude adapter with supportedEfforts', () => {
    const codexChat: Chat = { ...baseChat, adapterId: 'codex' };
    renderWithProviders(<EffortPicker chat={codexChat} adapters={[codexAdapter]} modelId="codex-mini-latest" />);
    expect(screen.getByRole('button', { name: /medium/i })).toBeTruthy();
  });

  it('persists the selected effort via setChatTuning and updates the store optimistically', async () => {
    renderWithProviders(<EffortPicker chat={baseChat} adapters={[claudeAdapter]} modelId="claude-opus-4-6" />);
    const trigger = screen.getByRole('button', { name: /medium/i });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'High' }));

    expect(updateChatSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', effort: 'high' }));
    expect(setChatTuningSpy).toHaveBeenCalledWith('c1', { effort: 'high' });
  });

  it('reflects the persisted effort on the trigger label', () => {
    renderWithProviders(
      <EffortPicker chat={{ ...baseChat, effort: 'low' }} adapters={[claudeAdapter]} modelId="claude-opus-4-6" />,
    );
    expect(screen.getByRole('button', { name: /low/i })).toBeTruthy();
  });

  it('shows xhigh and is disabled when ultracode is on', () => {
    renderWithProviders(
      <EffortPicker
        chat={{ ...baseChat, ultracode: true }}
        adapters={[claudeAdapter]}
        modelId="claude-opus-4-6"
      />,
    );
    const trigger = screen.getByTestId('composer-effort-select');
    expect(trigger).toHaveAttribute('disabled');
    // displayEffort coerces to xhigh for display
    expect(trigger.textContent).toContain('Extra-high');
  });
});
