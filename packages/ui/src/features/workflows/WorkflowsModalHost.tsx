/**
 * WorkflowsModalHost — single app-root outlet for the Workflows fullview modal.
 * Driven by useWorkflowsModal (zustand store).
 *
 * Listens for `mf:open-workflows` custom event (dispatched by SidebarHeader WorkflowsBtn).
 * Runs useWorkflowsEvents so the store stays live while the modal is mounted.
 * Triggers loadAll() when the modal opens.
 * Mounted once in AppShell's outlet block.
 */
import React, { useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useWorkflowsModal } from './use-workflows-modal';
import { useWorkflowsStore } from './use-workflows-store';
import { useWorkflowsEvents } from './use-workflows-events';
import { WorkflowsView } from './WorkflowsView';
import { WorkflowEditor } from './editor/WorkflowEditor';

interface Props {
  port: number;
}

export function WorkflowsModalHost({ port }: Props): React.ReactElement {
  const { open, openModal, close, editorTarget } = useWorkflowsModal();
  const loadAll = useWorkflowsStore((s) => s.loadAll);

  useWorkflowsEvents(port);

  // `mf:open-workflows` custom event (dispatched by SidebarHeader WorkflowsBtn)
  useEffect(() => {
    const h = () => openModal();
    window.addEventListener('mf:open-workflows', h);
    return () => window.removeEventListener('mf:open-workflows', h);
  }, [openModal]);

  // Eagerly load workflows when the modal opens so it shows current data.
  useEffect(() => {
    if (open) void loadAll(port);
  }, [open, port, loadAll]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent
        data-testid="workflows-modal"
        hideClose
        className="flex h-[88vh] max-h-[880px] w-full max-w-[1040px] flex-col gap-0 overflow-hidden p-0"
      >
        {editorTarget ? <WorkflowEditor port={port} target={editorTarget} /> : <WorkflowsView port={port} />}
      </DialogContent>
    </Dialog>
  );
}
