import { vi } from 'vitest';
import type { SessionSink } from '@qlan-ro/mainframe-types';

export function createMockSink(): SessionSink {
  return {
    onInit: vi.fn(),
    onMessage: vi.fn(),
    onToolResult: vi.fn(),
    onPermission: vi.fn(),
    onResult: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
    onCompact: vi.fn(),
    onPlanFile: vi.fn(),
    onSkillFile: vi.fn(),
  };
}
