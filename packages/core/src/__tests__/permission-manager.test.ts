import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PermissionManager } from '../chat/permission-manager.js';
import type { ControlRequest } from '@mainframe/types';

function makeRequest(overrides: Partial<ControlRequest> = {}): ControlRequest {
  return {
    requestId: 'req-1',
    toolName: 'Bash',
    toolUseId: 'tu-1',
    input: {},
    suggestions: [],
    ...overrides,
  };
}

describe('PermissionManager', () => {
  let pm: PermissionManager;
  let db: any;

  beforeEach(() => {
    db = {
      chats: { get: vi.fn() },
      settings: { get: vi.fn() },
    };
    const adapters = { get: vi.fn() } as any;
    pm = new PermissionManager(db, adapters);
  });

  describe('enqueue/shift FIFO', () => {
    it('returns true for first enqueue (is frontmost)', () => {
      expect(pm.enqueue('c1', makeRequest({ requestId: 'r1' }))).toBe(true);
    });

    it('returns false for subsequent enqueues', () => {
      pm.enqueue('c1', makeRequest({ requestId: 'r1' }));
      expect(pm.enqueue('c1', makeRequest({ requestId: 'r2' }))).toBe(false);
    });

    it('shift returns next request in FIFO order', () => {
      pm.enqueue('c1', makeRequest({ requestId: 'r1' }));
      pm.enqueue('c1', makeRequest({ requestId: 'r2' }));
      pm.enqueue('c1', makeRequest({ requestId: 'r3' }));

      const next1 = pm.shift('c1');
      expect(next1?.requestId).toBe('r2');

      const next2 = pm.shift('c1');
      expect(next2?.requestId).toBe('r3');

      const next3 = pm.shift('c1');
      expect(next3).toBeUndefined();
    });
  });

  describe('getPending', () => {
    it('returns null when no pending requests', () => {
      expect(pm.getPending('c1')).toBeNull();
    });

    it('returns first queued request', () => {
      pm.enqueue('c1', makeRequest({ requestId: 'r1' }));
      pm.enqueue('c1', makeRequest({ requestId: 'r2' }));
      expect(pm.getPending('c1')?.requestId).toBe('r1');
    });

    it('returns null in yolo mode', () => {
      db.chats.get.mockReturnValue({ permissionMode: 'yolo' });
      pm.enqueue('c1', makeRequest());
      expect(pm.getPending('c1')).toBeNull();
    });
  });

  describe('clear', () => {
    it('removes all pending for a chat', () => {
      pm.enqueue('c1', makeRequest());
      pm.enqueue('c1', makeRequest());
      pm.clear('c1');
      expect(pm.hasPending('c1')).toBe(false);
    });
  });

  describe('interrupted state', () => {
    it('markInterrupted and clearInterrupted work correctly', () => {
      pm.markInterrupted('c1');
      expect(pm.clearInterrupted('c1')).toBe(true);
      expect(pm.clearInterrupted('c1')).toBe(false);
    });
  });
});
