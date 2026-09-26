import { describe, expect, it } from 'vitest';
import { forkAvailability, type ForkAvailabilityInput } from '../fork-availability';

const BASE: ForkAvailabilityInput = {
  capabilityFork: true,
  adapterName: 'Codex',
  claudeSessionId: 'sess-1',
  transcriptMissing: false,
  directoryMissing: false,
  isRunning: false,
  hasPending: false,
};

describe('forkAvailability', () => {
  it('is enabled when every check passes', () => {
    expect(forkAvailability(BASE)).toEqual({ enabled: true });
  });

  it('reason 1: no fork capability names the adapter, checked before session presence', () => {
    expect(forkAvailability({ ...BASE, capabilityFork: false, claudeSessionId: undefined })).toEqual({
      enabled: false,
      reason: "Forking isn't available for Codex chats yet",
    });
  });

  it('reason 2: no provider session yet', () => {
    expect(forkAvailability({ ...BASE, claudeSessionId: undefined })).toEqual({
      enabled: false,
      reason: 'Nothing to fork yet',
    });
  });

  it('reason 3: transcript missing on disk', () => {
    expect(forkAvailability({ ...BASE, transcriptMissing: true })).toEqual({
      enabled: false,
      reason: "This chat's transcript is missing",
    });
  });

  it('reason 4: working directory missing', () => {
    expect(forkAvailability({ ...BASE, directoryMissing: true })).toEqual({
      enabled: false,
      reason: "This chat's folder is missing",
    });
  });

  it('reason 5: a running main turn', () => {
    expect(forkAvailability({ ...BASE, isRunning: true })).toEqual({
      enabled: false,
      reason: 'Wait for the current turn to finish or interrupt it',
    });
  });

  it('reason 5: a pending permission or question (waiting), even when not running', () => {
    expect(forkAvailability({ ...BASE, hasPending: true })).toEqual({
      enabled: false,
      reason: 'Wait for the current turn to finish or interrupt it',
    });
  });

  it('an idle chat with background tasks only (isRunning false, hasPending false) is enabled', () => {
    // displayStatus can read "working" from background tasks alone, but this
    // input never carries that signal — only the main-turn/pending flags do —
    // so BASE already models the background-tasks-only case.
    expect(forkAvailability(BASE)).toEqual({ enabled: true });
  });

  it('checks order 1 before order 5: no capability wins over a running turn', () => {
    expect(forkAvailability({ ...BASE, capabilityFork: false, isRunning: true })).toEqual({
      enabled: false,
      reason: "Forking isn't available for Codex chats yet",
    });
  });
});
