/**
 * createHttpGateway — the real `AutomationsGateway` over `lib/api/automations.ts`.
 * Most methods are 1:1 delegation (already covered by `api-automations.test.ts`);
 * this file pins the two shapes that actually transform: the run-detail split
 * (`getAutomationRun` → `{run, timeline}`, one call feeding two gateway
 * methods) and the credential-labels unwrap, plus the `onEvent` filter that
 * keeps non-`automation.*` daemon events (e.g. `chat.updated`) out of
 * automations listeners.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DaemonEvent } from '../../contract';

let wsHandler: (event: DaemonEvent) => void = () => {};
const unsubscribeSpy = vi.fn();
vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: {
    onEvent: (h: (event: DaemonEvent) => void) => {
      wsHandler = h;
      return unsubscribeSpy;
    },
  },
}));

vi.mock('@/lib/api/automations', () => ({
  listAutomations: vi.fn(),
  createAutomation: vi.fn(),
  getAutomation: vi.fn(),
  updateAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
  setAutomationEnabled: vi.fn(),
  startAutomationRun: vi.fn(),
  listAutomationRuns: vi.fn(),
  getAutomationRun: vi.fn(),
  cancelAutomationRun: vi.fn(),
  listAutomationInteractions: vi.fn(),
  respondAutomationInteraction: vi.fn(),
  listAutomationActions: vi.fn(),
  listAutomationCredentialLabels: vi.fn(),
  putAutomationCredential: vi.fn(),
  deleteAutomationCredential: vi.fn(),
}));

import * as api from '@/lib/api/automations';
import { createHttpGateway } from '../http-gateway';

const RUN_SUMMARY = {
  id: 'run-1',
  automationId: 'auto-1',
  status: 'succeeded' as const,
  trigger: { kind: 'manual' as const },
  startedAt: 1,
  finishedAt: 2,
  error: null,
};

const TIMELINE = [
  {
    stepRef: 'notify-1',
    stepId: 'notify-1',
    kind: 'notify' as const,
    status: 'succeeded' as const,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  wsHandler = () => {};
});

describe('createHttpGateway — pass-through verbs', () => {
  it('delegates setEnabled to setAutomationEnabled', async () => {
    vi.mocked(api.setAutomationEnabled).mockResolvedValue({ id: 'auto-1' } as never);
    const gateway = createHttpGateway();

    await gateway.setEnabled('auto-1', false);

    expect(api.setAutomationEnabled).toHaveBeenCalledWith('auto-1', false);
  });

  it('delegates startRun to startAutomationRun', async () => {
    vi.mocked(api.startAutomationRun).mockResolvedValue(RUN_SUMMARY);
    const gateway = createHttpGateway();

    const result = await gateway.startRun('auto-1');

    expect(api.startAutomationRun).toHaveBeenCalledWith('auto-1');
    expect(result).toEqual(RUN_SUMMARY);
  });
});

describe('createHttpGateway — getRun / getRunTimeline', () => {
  it('getRun calls getAutomationRun once and returns the run summary', async () => {
    vi.mocked(api.getAutomationRun).mockResolvedValue({ run: RUN_SUMMARY, timeline: TIMELINE });
    const gateway = createHttpGateway();

    const result = await gateway.getRun('run-1');

    expect(api.getAutomationRun).toHaveBeenCalledWith('run-1');
    expect(result).toEqual(RUN_SUMMARY);
  });

  it('getRunTimeline calls getAutomationRun and returns the timeline array', async () => {
    vi.mocked(api.getAutomationRun).mockResolvedValue({ run: RUN_SUMMARY, timeline: TIMELINE });
    const gateway = createHttpGateway();

    const result = await gateway.getRunTimeline('run-1');

    expect(result).toEqual(TIMELINE);
  });
});

describe('createHttpGateway — credential labels unwrap', () => {
  it('listCredentialLabels unwraps { labels } into a bare string[]', async () => {
    vi.mocked(api.listAutomationCredentialLabels).mockResolvedValue({ labels: ['github', 'notion'] });
    const gateway = createHttpGateway();

    const result = await gateway.listCredentialLabels();

    expect(result).toEqual(['github', 'notion']);
  });
});

describe('createHttpGateway — onEvent', () => {
  it('forwards automation.* events to the listener', () => {
    const gateway = createHttpGateway();
    const listener = vi.fn();
    gateway.onEvent(listener);

    const event: DaemonEvent = { type: 'automation.run.updated', run: RUN_SUMMARY };
    wsHandler(event);

    expect(listener).toHaveBeenCalledWith(event);
  });

  it('does not forward non-automation daemon events (e.g. chat.updated)', () => {
    const gateway = createHttpGateway();
    const listener = vi.fn();
    gateway.onEvent(listener);

    wsHandler({ type: 'chat.updated', chat: { id: 'chat-1' } } as unknown as DaemonEvent);

    expect(listener).not.toHaveBeenCalled();
  });

  it('returns the daemonWs unsubscribe function', () => {
    const gateway = createHttpGateway();
    const unsubscribe = gateway.onEvent(vi.fn());
    unsubscribe();
    expect(unsubscribeSpy).toHaveBeenCalledOnce();
  });
});
