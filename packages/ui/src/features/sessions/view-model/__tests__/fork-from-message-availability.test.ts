import { describe, expect, it } from 'vitest';
import type { ProviderSwitchMarker } from '@qlan-ro/mainframe-types';
import {
  forkFromMessageAvailability,
  latestSegmentBlock,
  type ForkFromMessageInput,
  type SegmentedMessage,
} from '../fork-from-message-availability';

const BASE: ForkFromMessageInput = {
  capabilityFork: true,
  adapterName: 'Codex',
  temporary: false,
  noProject: false,
  claudeSessionId: 'sess-1',
  transcriptMissing: false,
  directoryMissing: false,
  messageUnsent: false,
  isFirstUserMessage: false,
};

/** Every check failing at once — each case below clears the earlier ones. */
const ALL_FAILING: ForkFromMessageInput = {
  ...BASE,
  capabilityFork: false,
  claudeSessionId: undefined,
  transcriptMissing: true,
  directoryMissing: true,
  messageUnsent: true,
  isFirstUserMessage: true,
  beforeLatestSegment: { kind: 'provider_switch', toAdapterName: 'Claude' },
};

const reasonOf = (input: ForkFromMessageInput) => {
  const result = forkFromMessageAvailability(input);
  return result.enabled ? null : result.reason;
};

describe('forkFromMessageAvailability', () => {
  it('is enabled when every check passes', () => {
    expect(forkFromMessageAvailability(BASE)).toEqual({ enabled: true });
  });

  it('reports each reason in the spec order', () => {
    expect(reasonOf(ALL_FAILING)).toBe("Forking isn't available for Codex chats yet");
    const step2 = { ...ALL_FAILING, capabilityFork: true };
    expect(reasonOf(step2)).toBe('Nothing to fork yet');
    const step3 = { ...step2, claudeSessionId: 'sess-1' };
    expect(reasonOf(step3)).toBe("This chat's transcript is missing");
    const step4 = { ...step3, transcriptMissing: false };
    expect(reasonOf(step4)).toBe("This chat's folder is missing");
    const step5 = { ...step4, directoryMissing: false };
    expect(reasonOf(step5)).toBe("This message hasn't been sent yet");
    const step6 = { ...step5, messageUnsent: false };
    expect(reasonOf(step6)).toBe('Nothing before this message to fork');
    const step7 = { ...step6, isFirstUserMessage: false };
    expect(reasonOf(step7)).toBe("Can't fork from before the switch to Claude");
    expect(reasonOf({ ...step7, beforeLatestSegment: null })).toBeNull();
  });

  it("prefers the adapter's version-specific reason", () => {
    expect(reasonOf({ ...BASE, capabilityFork: false, capabilityReason: 'Needs Codex CLI 0.143.0 or newer' })).toBe(
      'Needs Codex CLI 0.143.0 or newer',
    );
  });
});

describe('the latest provider segment', () => {
  it('names a context reset differently', () => {
    const input = { ...BASE, beforeLatestSegment: { kind: 'context_reset' as const, toAdapterName: 'Claude' } };
    expect(reasonOf(input)).toBe("Can't fork from before this chat's context was cleared");
  });

  const marker = { kind: 'provider_switch', toAdapterName: 'Codex' } as ProviderSwitchMarker;
  const user = (id: string): SegmentedMessage => ({ id, role: 'user' });
  const thread: SegmentedMessage[] = [
    user('u1'),
    { id: 'a1', role: 'assistant' },
    { id: 'segdiv-s1', role: 'system', metadata: { custom: { mainframe: { providerSwitch: marker } } } },
    user('x1'),
    { id: 'xa1', role: 'assistant' },
    user('x2'),
  ];

  it('blocks messages before the latest divider and the segment opener', () => {
    expect(latestSegmentBlock(thread, 'u1')).toBe(marker);
    expect(latestSegmentBlock(thread, 'x1')).toBe(marker);
  });

  it('allows later messages in the latest segment, and chats that never switched', () => {
    expect(latestSegmentBlock(thread, 'x2')).toBeNull();
    expect(latestSegmentBlock([user('u1'), user('u2')], 'u2')).toBeNull();
    expect(latestSegmentBlock(thread, 'missing')).toBeNull();
  });
});
