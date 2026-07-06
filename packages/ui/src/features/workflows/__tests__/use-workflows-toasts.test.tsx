/**
 * useWorkflowsToasts — toast notifications for workflow events.
 *
 * Pins:
 *   1. workflow.interaction.created → mfToast.info called with title containing
 *      "needs your input" and an action that opens the workflows modal at 'needs'.
 *   2. workflow.completed → mfToast.info called with title containing
 *      "finished" and an action that opens the workflows modal at 'runs' + openRun.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks (hoisted before the imports that touch these modules)
// ---------------------------------------------------------------------------

let handler: (e: unknown) => void = () => {};
vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: {
    onEvent: (h: (e: unknown) => void) => {
      handler = h;
      return () => {};
    },
  },
}));

// Use a factory with no outer-scope vars so hoisting works correctly.
vi.mock('@/lib/toast', () => {
  const infoFn = vi.fn();
  return {
    mfToast: Object.assign(infoFn, {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: infoFn,
    }),
  };
});

const mockOpenModal = vi.fn();
const mockOpenRun = vi.fn();
vi.mock('@/features/workflows/use-workflows-modal', () => ({
  useWorkflowsModal: {
    getState: () => ({
      openModal: mockOpenModal,
      openRun: mockOpenRun,
    }),
  },
}));

// ---------------------------------------------------------------------------
// Subject under test (import after mocks)
// ---------------------------------------------------------------------------

import { useWorkflowsToasts } from '@/features/workflows/use-workflows-toasts';
import { mfToast } from '@/lib/toast';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  handler = () => {};
  vi.clearAllMocks();
});

describe('useWorkflowsToasts', () => {
  describe('workflow.interaction.created', () => {
    it('fires mfToast.info with a "needs your input" title', () => {
      renderHook(() => useWorkflowsToasts(31415));

      handler({
        type: 'workflow.interaction.created',
        interaction: {
          id: 'i1',
          runId: 'run-1',
          stepPath: 'step.question',
          title: 'Approve deploy',
          formSchema: [],
          createdAt: 1000,
          expiresAt: null,
        },
      });

      expect(vi.mocked(mfToast.info)).toHaveBeenCalledOnce();
      const call = vi.mocked(mfToast.info).mock.calls[0]!;
      expect(call[0]).toContain('needs your input');
    });

    it('action dispatches mf:open-workflows and opens modal at needs section', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      renderHook(() => useWorkflowsToasts(31415));

      handler({
        type: 'workflow.interaction.created',
        interaction: {
          id: 'i2',
          runId: 'run-2',
          stepPath: 'step.question',
          title: 'Confirm rollback',
          formSchema: [],
          createdAt: 2000,
          expiresAt: null,
        },
      });

      const call = vi.mocked(mfToast.info).mock.calls[0]!;
      const opts = call[1] as { action?: { onClick: () => void } };
      expect(opts.action).toBeDefined();

      opts.action!.onClick();

      expect(mockOpenModal).toHaveBeenCalledWith('needs');
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'mf:open-workflows' }));
    });
  });

  describe('workflow.completed', () => {
    it('fires mfToast.info with a "finished" title containing the workflow name', () => {
      renderHook(() => useWorkflowsToasts(31415));

      handler({
        type: 'workflow.completed',
        workflowId: 'wf-1',
        workflowName: 'Deploy Pipeline',
        runId: 'run-3',
        outputs: {},
      });

      expect(vi.mocked(mfToast.info)).toHaveBeenCalledOnce();
      const call = vi.mocked(mfToast.info).mock.calls[0]!;
      expect(call[0]).toContain('Deploy Pipeline');
      expect(call[0]).toContain('finished');
    });

    it('action opens modal at runs section and selects the run', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      renderHook(() => useWorkflowsToasts(31415));

      handler({
        type: 'workflow.completed',
        workflowId: 'wf-2',
        workflowName: 'Sync Data',
        runId: 'run-4',
        outputs: {},
      });

      const call = vi.mocked(mfToast.info).mock.calls[0]!;
      const opts = call[1] as { action?: { label: string; onClick: () => void } };
      expect(opts.action).toBeDefined();
      expect(opts.action!.label).toBe('View run');

      opts.action!.onClick();

      expect(mockOpenModal).toHaveBeenCalledWith('runs');
      expect(mockOpenRun).toHaveBeenCalledWith('run-4');
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'mf:open-workflows' }));
    });
  });
});
