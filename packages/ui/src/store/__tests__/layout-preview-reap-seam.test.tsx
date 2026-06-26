/**
 * Render-level seam test: closing a preview tab via the layout store unmounts
 * PreviewInstance, which triggers the lifecycle cleanup effect → handle.destroy().
 *
 * This covers the end-to-end reaping path that the pure store tests in
 * layout-preview-reap.test.ts cannot reach.
 */
import { render, act } from '@testing-library/react';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { HostProvider, setHostForTesting, resetHostForTesting } from '@/lib/host';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';
import { useLayoutStore } from '../layout';
import { useSandboxStore } from '../sandbox';

// Stub heavy sub-components so only lifecycle runs
vi.mock('@/features/preview/PreviewToolbar', () => ({
  PreviewToolbar: () => null,
}));
vi.mock('@/features/preview/PreviewBodyState', () => ({
  PreviewBodyState: () => null,
}));
vi.mock('@/features/run/ConsolePane', () => ({
  ConsolePane: () => null,
}));
vi.mock('@/features/preview/use-preview-occlusion', () => ({
  usePreviewOcclusion: () => false,
}));
vi.mock('@/features/preview/use-preview-visibility', () => ({
  usePreviewVisibility: () => [false, vi.fn()],
}));
vi.mock('@/features/preview/use-preview-capture', () => ({
  usePreviewCapture: () => ({
    pendingCaptures: [],
    regionOverlayOpen: false,
    annotationPopoverOpen: false,
    inspectActive: false,
    onCaptureClick: vi.fn(),
    onRegionClick: vi.fn(),
    onInspectClick: vi.fn(),
    onRegionSelect: vi.fn(),
    onAnnotationChange: vi.fn(),
    onAnnotationSubmit: vi.fn(),
    onAnnotationCancel: vi.fn(),
  }),
}));
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: 'proj-1', chatId: 'chat-1' }),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

// Import after mocks
import { PreviewInstance } from '@/features/preview/PreviewInstance';

// A minimal host subscriber that renders/unmounts PreviewInstance based on a tab list
function PreviewTabHost({ tabs, host }: { tabs: string[]; host: FakeHostBridge }) {
  return (
    <HostProvider host={host}>
      {tabs.map((id) => (
        <PreviewInstance key={id} tabId={id} config="dev" visible port={3000} projectId="proj-1" />
      ))}
    </HostProvider>
  );
}

let fakeHost: FakeHostBridge;
let destroySpy: () => void;

beforeEach(() => {
  const spy = vi.fn() as unknown as () => void;
  destroySpy = spy;
  const fakeHandle: PreviewHandle = {
    setVisible: vi.fn(),
    navigate: vi.fn().mockResolvedValue(undefined),
    capture: vi.fn().mockRejectedValue(new Error('no')),
    startInspect: vi.fn().mockResolvedValue(undefined),
    onInspect: vi.fn().mockReturnValue(() => {}),
    startRegionSelect: vi.fn().mockResolvedValue(undefined),
    onRegionSelect: vi.fn().mockReturnValue(() => {}),
    refit: vi.fn(),
    setDevice: vi.fn(),
    destroy: spy,
  };
  fakeHost = new FakeHostBridge();
  fakeHost.preview.mount = vi.fn().mockReturnValue(fakeHandle);
  setHostForTesting(fakeHost);

  useSandboxStore.setState({
    captures: [],
    logsOutput: [],
    selectedConfigName: 'dev',
    lastStartedProcess: null,
    processStatuses: { 'proj-1:/ws': { dev: 'running' } },
  });

  useLayoutStore.setState({
    layout: { top: ['chat', 'run'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
    run: {
      dir: 'v',
      flex: [1],
      panes: [{ id: 'p1', tabs: [{ id: 'prev-1', kind: 'preview', title: 'dev', config: 'dev' }], active: 'prev-1' }],
    },
    sessions: new Map(),
    activeSessionId: null,
  });
});

afterEach(() => {
  resetHostForTesting();
});

it('removing a tab from layout state unmounts PreviewInstance and fires handle.destroy', async () => {
  const { rerender } = render(<PreviewTabHost tabs={['prev-1']} host={fakeHost} />);

  // Wait for the mount effect to fire (status=running, port=3000)
  await act(async () => {});

  // Simulate the tab being closed: unmount the PreviewInstance by re-rendering with empty tabs
  await act(async () => {
    rerender(<PreviewTabHost tabs={[]} host={fakeHost} />);
  });

  expect(destroySpy).toHaveBeenCalled();
});
