/**
 * ProviderModelSelect — switching a chat's provider in place (after the first
 * message): tabs browse catalogs, picking another provider's model asks to
 * switch, and a blocked switch disables the other tabs with the daemon's copy.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { AdapterInfo, Chat } from '@qlan-ro/mainframe-types';
import { ProviderModelSelect } from '../ProviderModelSelect';
import { providerSwitchBlockedReason } from '../provider-switch';

const CLAUDE: AdapterInfo = {
  id: 'claude',
  name: 'Claude',
  description: '',
  installed: true,
  models: [{ id: 'model-a', label: 'Model A' }],
  capabilities: { planMode: true },
};
const CODEX: AdapterInfo = {
  id: 'codex',
  name: 'Codex',
  description: '',
  installed: true,
  models: [{ id: 'codex-pro', label: 'Codex Pro' }],
  capabilities: { planMode: true },
};

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    adapterId: 'claude',
    projectId: 'p',
    status: 'active',
    createdAt: '',
    updatedAt: '',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    temporary: false,
    noProject: false,
    model: 'model-a',
    ...overrides,
  };
}

function renderSwitch(blockedReason: string | null = null) {
  const onSwitchProvider = vi.fn();
  const setAdapter = vi.fn();
  const setModel = vi.fn();
  render(
    <TooltipProvider>
      <ProviderModelSelect
        chat={chat()}
        adapters={[CLAUDE, CODEX]}
        adapter={CLAUDE}
        model={CLAUDE.models[0] ?? null}
        locked
        disabled={false}
        setAdapter={setAdapter}
        setModel={setModel}
        setModelTuning={vi.fn()}
        setEffort={vi.fn()}
        setFeature={vi.fn()}
        switchBlockedReason={blockedReason}
        onSwitchProvider={onSwitchProvider}
      />
    </TooltipProvider>,
  );
  return { onSwitchProvider, setAdapter, setModel };
}

describe('ProviderModelSelect — switching providers after the first message', () => {
  it('a tab browses its catalog without switching anything', async () => {
    const { setAdapter, onSwitchProvider } = renderSwitch();
    await userEvent.click(screen.getByTestId('composer-model-select'));
    await userEvent.click(screen.getByTestId('composer-adapter-select-option-codex'));
    expect(await screen.findByText('Codex models')).toBeInTheDocument();
    expect(setAdapter).not.toHaveBeenCalled();
    expect(onSwitchProvider).not.toHaveBeenCalled();
  });

  it("picking another provider's model asks to switch to it", async () => {
    const { onSwitchProvider, setModel } = renderSwitch();
    await userEvent.click(screen.getByTestId('composer-model-select'));
    await userEvent.click(screen.getByTestId('composer-adapter-select-option-codex'));
    await userEvent.click(await screen.findByText('Codex Pro'));
    expect(onSwitchProvider).toHaveBeenCalledWith({ adapterId: 'codex', model: 'codex-pro' });
    expect(setModel).not.toHaveBeenCalled();
  });

  it('a blocked switch disables the other tabs with the reason', async () => {
    renderSwitch('Send or cancel queued messages before switching providers');
    await userEvent.click(screen.getByTestId('composer-model-select'));
    expect(screen.getByTestId('composer-adapter-select-option-codex')).toBeDisabled();
    expect(screen.getByTestId('composer-adapter-switch-blocked-codex')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-adapter-switch-blocked-claude')).toBeNull();
    expect(screen.getByTestId('composer-adapter-select-option-claude')).not.toBeDisabled();
  });
});

describe('providerSwitchBlockedReason', () => {
  it('names each blocking condition in the daemon refusal order', () => {
    expect(providerSwitchBlockedReason(chat(), 0, 'Claude')).toBeNull();
    expect(providerSwitchBlockedReason(chat({ temporary: true, parentChatId: 'p1' }), 0, 'Claude')).toBe(
      "Side chats keep their parent's provider",
    );
    expect(providerSwitchBlockedReason(chat({ temporary: true }), 0, 'Claude')).toBe(
      "Temporary chats can't switch providers",
    );
    expect(providerSwitchBlockedReason(chat({ displayStatus: 'waiting' }), 2, 'Claude')).toBe(
      'Wait for the current turn to finish or interrupt it',
    );
    expect(providerSwitchBlockedReason(chat({ processState: 'working' }), 0, 'Claude')).toBe(
      'Wait for the current turn to finish or interrupt it',
    );
    expect(providerSwitchBlockedReason(chat(), 1, 'Claude')).toBe(
      'Send or cancel queued messages before switching providers',
    );
    const busy = chat({ backgroundActivity: { total: 1, byKind: {}, tasks: [] } });
    expect(providerSwitchBlockedReason(busy, 0, 'Claude')).toBe(
      'Claude is still running background agents or commands, and switching would end them. Wait for them to finish, or press Stop, then switch.',
    );
  });
});
