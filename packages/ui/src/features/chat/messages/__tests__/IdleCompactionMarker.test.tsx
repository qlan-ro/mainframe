import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainframeMessageMeta } from '../../view-model/message-meta';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SystemMessage } from '../SystemMessage';

const state = vi.hoisted(() => ({ id: 'idle-message-1', meta: {} as MainframeMessageMeta }));
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (value: unknown) => unknown) => selector({ message: { id: state.id } }),
  MessagePrimitive: { Root: ({ children }: { children: ReactNode }) => <div>{children}</div>, Parts: () => null },
}));
vi.mock('../../view-model/message-meta', () => ({ useMainframeMeta: () => state.meta }));
vi.mock('../../tools/cards/SkillLoadedCard', () => ({ SkillLoadedCard: () => null }));
vi.mock('../ProviderSwitchMarker', () => ({ ProviderSwitchMarker: () => null }));

const compaction = { origin: 'idle', requestId: 'request-1', sessionGeneration: 'generation-1' } as const;
function mount() {
  return render(
    <TooltipProvider delayDuration={0}>
      <SystemMessage />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  state.meta = { isCompacted: true, compaction, actionable: false };
});

describe('idle compaction transcript marker', () => {
  it.each(['light', 'dark'])('keeps the existing separator/icon recipe in %s mode', (theme) => {
    document.documentElement.className = theme;
    state.meta = { ...state.meta, compaction: { ...compaction, beforeTokens: 197000, afterTokens: 19000 } };
    mount();
    const marker = screen.getByTestId('idle-compaction-idle-message-1');
    expect(marker).toHaveAttribute('data-variant', 'separator');
    expect(marker).toHaveTextContent('Compacted while idle · 197k → 19k tokens');
    expect(marker.querySelector('[data-slot="marker-icon"] svg')).not.toBeNull();
    expect(marker.querySelector('.text-muted-foreground\\/60')).not.toBeNull();
    expect(screen.queryByTestId('chat-compaction-pill')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Compacting/)).toBeNull();
    document.documentElement.className = '';
  });

  it.each([{}, { beforeTokens: 197000 }, { afterTokens: 19000 }])('omits incomplete token counts %j', (counts) => {
    state.meta = { ...state.meta, compaction: { ...compaction, ...counts } };
    mount();
    expect(screen.getByTestId('idle-compaction-idle-message-1')).toHaveTextContent(/^Compacted while idle$/);
  });

  it('shows the exact approved tooltip', async () => {
    mount();
    await userEvent.hover(screen.getByTestId('idle-compaction-idle-message-1'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Compacted before the prompt cache expired, so returning to this chat is cheaper.',
    );
    fireEvent.pointerLeave(screen.getByTestId('idle-compaction-idle-message-1'));
  });

  it('retains ordinary compaction label and selector', () => {
    state.meta = { isCompacted: true };
    mount();
    expect(screen.getByTestId('chat-compaction-pill')).toHaveTextContent('Context compacted');
    expect(screen.queryByText('Compacted while idle')).toBeNull();
  });
});
