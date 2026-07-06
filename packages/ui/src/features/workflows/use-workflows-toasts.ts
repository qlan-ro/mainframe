/**
 * useWorkflowsToasts — daemon-driven toast notifications for workflow events.
 *
 * Mounted once (in WorkflowsModalHost) so notifications fire even when the
 * fullview is closed — that's the whole point.
 *
 * Events handled:
 *   workflow.interaction.created → "needs your input" info toast
 *   workflow.completed           → "<name> finished" info toast with "View run" action
 */
import { useEffect } from 'react';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import { daemonWs } from '@/lib/daemon/ws-client';
import { mfToast } from '@/lib/toast';
import { useWorkflowsModal } from './use-workflows-modal';

export function useWorkflowsToasts(port: number): void {
  useEffect(() => {
    return daemonWs.onEvent((event: DaemonEvent) => {
      switch (event.type) {
        case 'workflow.interaction.created': {
          const { interaction } = event;
          mfToast.info(`${interaction.title} — needs your input`, {
            action: {
              label: 'View',
              onClick: () => {
                window.dispatchEvent(new CustomEvent('mf:open-workflows'));
                useWorkflowsModal.getState().openModal('needs');
              },
            },
          });
          break;
        }
        case 'workflow.completed': {
          const { workflowName, runId } = event;
          mfToast.info(`${workflowName} finished`, {
            action: {
              label: 'View run',
              onClick: () => {
                window.dispatchEvent(new CustomEvent('mf:open-workflows'));
                useWorkflowsModal.getState().openModal('runs');
                useWorkflowsModal.getState().openRun(runId);
              },
            },
          });
          break;
        }
        default:
          break;
      }
    });
  }, [port]);
}
