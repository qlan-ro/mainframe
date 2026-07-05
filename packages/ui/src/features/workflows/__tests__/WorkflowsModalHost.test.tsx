/**
 * WorkflowsModalHost — Escape-to-close regression.
 *
 * The modal's close button is Hint-wrapped (a Radix Tooltip trigger). Radix
 * Dialog autofocuses the first tabbable descendant on open, which is that
 * button — and focusing a Tooltip trigger (keyboard a11y) opens the tooltip,
 * mounting its own Radix DismissableLayer *above* the Dialog's. Escape then
 * dismisses whichever layer is topmost: the tooltip first, the modal second.
 * A single Escape press must close the modal.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: { onEvent: () => () => {} },
}));
vi.mock('@/lib/api/workflows', () => ({
  listWorkflows: vi.fn().mockResolvedValue([]),
  listInteractions: vi.fn().mockResolvedValue([]),
  listRuns: vi.fn().mockResolvedValue([]),
}));

import { WorkflowsModalHost } from '@/features/workflows/WorkflowsModalHost';
import { useWorkflowsModal } from '@/features/workflows/use-workflows-modal';
import { useWorkflowsStore } from '@/features/workflows/use-workflows-store';

describe('WorkflowsModalHost — Escape dismissal', () => {
  beforeEach(() => {
    useWorkflowsModal.setState({ open: false, section: 'needs', selectedRunId: null, editorTarget: null });
    useWorkflowsStore.setState({
      workflows: [],
      runs: [],
      interactions: [],
      runDetail: null,
      loading: false,
      error: null,
    });
  });

  it('closes on the first Escape press', async () => {
    useWorkflowsModal.setState({ open: true });
    render(<WorkflowsModalHost port={31415} />);

    expect(await screen.findByTestId('workflows-modal')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(useWorkflowsModal.getState().open).toBe(false);
  });
});
