import { describe, expect, it } from 'vitest';
import { forkFromMessageAvailability, type ForkFromMessageInput } from '../fork-from-message-availability';

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
    expect(reasonOf({ ...step6, isFirstUserMessage: false })).toBeNull();
  });

  it("prefers the adapter's version-specific reason", () => {
    expect(reasonOf({ ...BASE, capabilityFork: false, capabilityReason: 'Needs Codex CLI 0.143.0 or newer' })).toBe(
      'Needs Codex CLI 0.143.0 or newer',
    );
  });
});
