import { useEffect } from 'react';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import { daemonWs } from '@/lib/daemon/ws-client';
import { useWorkflowsStore } from './use-workflows-store';

export function useWorkflowsEvents(port: number): void {
  useEffect(() => {
    const s = useWorkflowsStore.getState();
    return daemonWs.onEvent((event: DaemonEvent) => {
      switch (event.type) {
        case 'workflow.run.updated':
          s.patchRun(event.run);
          break;
        case 'workflow.step.updated': {
          // Tree is authoritative; if this run's detail is open, refetch it.
          const open = useWorkflowsStore.getState().runDetail;
          if (open && open.run.id === event.runId) {
            void useWorkflowsStore.getState().selectRun(port, event.runId);
          }
          break;
        }
        case 'workflow.interaction.created':
          s.addInteraction(event.interaction);
          break;
        case 'workflow.interaction.resolved':
          s.resolveInteraction(event.interactionId);
          break;
        case 'workflow.completed': {
          const open = useWorkflowsStore.getState().runDetail;
          if (open && open.run.id === event.runId) {
            void useWorkflowsStore.getState().selectRun(port, event.runId);
          }
          break;
        }
        default:
          break;
      }
    });
  }, [port]);
}
