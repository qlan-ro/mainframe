/**
 * The provider-switch divider: each label state, the hint lines, the testid
 * keyed by segment id, and the ACP meta reaching the system container.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ThreadMessageLike } from '@assistant-ui/react';
import { providerSwitchLabel, type AdapterInfo, type ProviderSwitchMarker as Marker } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAdaptersStore } from '@/store/adapters';
import { ProviderSwitchMarker, providerSwitchHint } from '../ProviderSwitchMarker';
import { convertAcpItems } from '../../view-model/convert-acp-item';
import type { AccumulatedItem } from '../../view-model/acp-item-accumulator';
import type { MainframeMessageMeta } from '../../view-model/message-meta';

function marker(overrides: Partial<Marker> = {}): Marker {
  return {
    segmentId: 'seg_1',
    kind: 'provider_switch',
    fromAdapterId: 'claude',
    toAdapterId: 'codex',
    fromAdapterName: 'Claude',
    toAdapterName: 'Codex',
    toModel: 'codex-pro',
    resumed: false,
    previous: {
      adapterId: 'claude',
      model: 'model-a',
      turnCount: 3,
      totalCost: 0.5,
      totalTokensInput: 12000,
      totalTokensOutput: 800,
    },
    handoff: null,
    ...overrides,
  };
}

const handoff = (itemCount: number, omittedCount: number, fellBackToFresh = false) => ({
  id: 'ho_1',
  strategy: 'full' as const,
  status: 'delivered' as const,
  itemCount,
  omittedCount,
  fellBackToFresh,
});

describe('providerSwitchLabel', () => {
  it('covers every divider state', () => {
    expect(providerSwitchLabel(marker())).toBe('Switched to Codex · context hands off with your next message');
    expect(providerSwitchLabel(marker({ handoff: handoff(12, 3) }))).toBe(
      'Switched to Codex · context handed off (12 items, 3 omitted)',
    );
    expect(providerSwitchLabel(marker({ resumed: true }))).toBe(
      'Back to Codex · resumes its earlier session with your next message',
    );
    expect(providerSwitchLabel(marker({ resumed: true, handoff: handoff(1, 0) }))).toBe(
      'Back to Codex · resumed earlier session · caught up (1 item)',
    );
    expect(providerSwitchLabel(marker({ handoff: handoff(4, 0, true) }))).toBe(
      'Back to Codex · new session · context handed off (4 items)',
    );
    expect(providerSwitchLabel(marker({ kind: 'context_reset', toAdapterName: 'Claude' }))).toBe(
      'New Claude session · earlier context cleared',
    );
  });
});

describe('ProviderSwitchMarker', () => {
  beforeEach(() => {
    useAdaptersStore.setState({
      byId: {
        codex: { id: 'codex', name: 'Codex', models: [{ id: 'codex-pro', label: 'Codex Pro' }] } as AdapterInfo,
      },
    });
  });

  it('renders the label under a testid keyed by segment id', () => {
    render(
      <TooltipProvider>
        <ProviderSwitchMarker marker={marker({ handoff: handoff(2, 0) })} />
      </TooltipProvider>,
    );
    const divider = screen.getByTestId('chat-provider-switch-marker-seg_1');
    expect(divider.textContent).toBe('Switched to Codex · context handed off (2 items)');
    expect(screen.getByTestId('chat-provider-switch-logo-seg_1')).toBeInTheDocument();
  });

  it('hints the target model and the previous segment totals, plus the fallback reason', () => {
    expect(providerSwitchHint(marker(), 'Codex Pro')).toEqual([
      'Codex · Codex Pro',
      'Claude: 3 turns · 12,000 tokens in',
    ]);
    const fresh = providerSwitchHint(marker({ handoff: handoff(1, 0, true) }), null);
    expect(fresh[0]).toBe('Codex');
    expect(fresh[2]).toBe("Codex's earlier session was too full to catch up, so a new one started.");
  });
});

describe('convertAcpItems — provider switch divider', () => {
  it('carries the providerSwitch meta into the system container', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'segdiv-seg_1',
        role: 'agent',
        content: [{ type: 'text', text: 'Switched to Codex · context hands off with your next message' }],
        meta: { '_mainframe.dev': { kind: 'system', providerSwitch: marker() } },
      },
    ];
    const container = convertAcpItems(items, () => new Date(0))[0] as ThreadMessageLike;
    expect(container.role).toBe('system');
    const meta = (container.metadata?.custom as { mainframe?: MainframeMessageMeta }).mainframe;
    expect(meta?.providerSwitch?.segmentId).toBe('seg_1');
  });
});
