import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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

import { FeaturesPopover } from '../../../renderer/components/chat/assistant-ui/composer/FeaturesPopover';

// Helper: build a minimal valid Chat
function chatFor(adapterId: string): Chat {
  return {
    id: 'test-chat-1',
    adapterId,
    projectId: 'p1',
    status: 'active',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
  };
}

// Helper: build an AdapterInfo with a single model
function adaptersWith(
  modelPartial: { id: string } & Partial<{
    supportsFast: boolean;
    supportsUltracode: boolean;
    supportsAdaptiveThinking: boolean;
    supportedEfforts: string[];
  }>,
): AdapterInfo[] {
  const { id, supportsFast, supportsUltracode, supportsAdaptiveThinking, supportedEfforts } = modelPartial;
  return [
    {
      id: 'codex',
      name: 'Codex',
      description: '',
      installed: true,
      capabilities: { planMode: false },
      models: [
        {
          id: id,
          label: id,
          supportsFast,
          supportsUltracode,
          supportsAdaptiveThinking,
          supportedEfforts: supportedEfforts as import('@qlan-ro/mainframe-types').EffortLevel[] | undefined,
        },
      ],
    },
    {
      id: 'claude',
      name: 'Claude Code',
      description: '',
      installed: true,
      capabilities: { planMode: false },
      models: [
        {
          id: id,
          label: id,
          supportsFast,
          supportsUltracode,
          supportsAdaptiveThinking,
          supportedEfforts: supportedEfforts as import('@qlan-ro/mainframe-types').EffortLevel[] | undefined,
        },
      ],
    },
  ];
}

describe('FeaturesPopover', () => {
  beforeEach(() => {
    setChatTuningSpy.mockReset();
    setChatTuningSpy.mockResolvedValue(undefined);
    updateChatSpy.mockReset();
  });

  it('shows only supported features; Codex → fast only', () => {
    render(
      <FeaturesPopover
        chat={chatFor('codex')}
        adapters={adaptersWith({ id: 'gpt', supportsFast: true })}
        modelId="gpt"
      />,
    );
    fireEvent.click(screen.getByTestId('composer-features-trigger'));
    expect(screen.getByTestId('composer-feature-fast')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-feature-ultracode')).toBeNull();
  });

  it('hides the trigger when no features are supported', () => {
    render(<FeaturesPopover chat={chatFor('claude')} adapters={adaptersWith({ id: 'haiku' })} modelId="haiku" />);
    expect(screen.queryByTestId('composer-features-trigger')).toBeNull();
  });

  it('toggling ultracode persists the RAW field only (no UI coercion)', () => {
    const spy = vi.spyOn({ setChatTuning: setChatTuningSpy }, 'setChatTuning').mockResolvedValue(undefined);
    void spy; // spy is on the module mock; just use setChatTuningSpy directly
    render(
      <FeaturesPopover
        chat={chatFor('claude')}
        adapters={adaptersWith({
          id: 'opus',
          supportsFast: true,
          supportsUltracode: true,
          supportsAdaptiveThinking: true,
          supportedEfforts: ['low', 'xhigh'],
        })}
        modelId="opus"
      />,
    );
    fireEvent.click(screen.getByTestId('composer-features-trigger'));
    fireEvent.click(screen.getByTestId('composer-feature-ultracode'));
    expect(setChatTuningSpy).toHaveBeenCalledWith('test-chat-1', { ultracode: true });
    // Must NOT include effort in the patch
    expect(setChatTuningSpy).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ effort: expect.anything() }),
    );
  });
});
