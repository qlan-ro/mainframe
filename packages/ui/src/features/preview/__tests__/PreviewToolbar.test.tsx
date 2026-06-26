/**
 * PreviewToolbar — unit tests.
 *
 * Behaviors covered:
 *  - Renders with data-testid="preview-toolbar"
 *  - Renders device toggle (preview-device-toggle, preview-device-desktop, preview-device-mobile)
 *  - Reload button calls handle.navigate when running
 *  - Capture cluster has data-testid="preview-capture-cluster"
 *  - Run/Stop primary control reflects status and fires the right callback
 */
import { it, expect, vi, describe, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { LaunchProcessStatus, PreviewHandle } from '@qlan-ro/mainframe-types';

const onRun = vi.fn();
const onStop = vi.fn();
const onRestart = vi.fn();

let fakeHandle: PreviewHandle;

async function renderToolbar(status: LaunchProcessStatus | null) {
  const { PreviewToolbar } = await import('../PreviewToolbar');
  render(
    <PreviewToolbar
      tabId="t1"
      port={3000}
      configName="dev"
      projectId="p1"
      daemonPort={31415}
      status={status}
      device="desktop"
      onDeviceChange={() => {}}
      onRun={onRun}
      onStop={onStop}
      onRestart={onRestart}
      inspectActive={false}
      onCaptureClick={() => {}}
      onRegionClick={() => {}}
      onInspectClick={() => {}}
      handle={fakeHandle}
    />,
  );
}

describe('PreviewToolbar', () => {
  beforeEach(() => {
    fakeHandle = {
      setVisible: vi.fn(),
      navigate: vi.fn().mockResolvedValue(undefined),
      capture: vi.fn().mockResolvedValue(new Uint8Array()),
      startInspect: vi.fn().mockResolvedValue(undefined),
      onInspect: vi.fn().mockReturnValue(() => {}),
      startRegionSelect: vi.fn().mockResolvedValue(undefined),
      onRegionSelect: vi.fn().mockReturnValue(() => {}),
      refit: vi.fn(),
      setDevice: vi.fn(),
      destroy: vi.fn(),
    };
    onRun.mockReset();
    onStop.mockReset();
    onRestart.mockReset();
  });

  it('renders with data-testid="preview-toolbar" on the toolbar container', async () => {
    await renderToolbar('running');
    expect(screen.getByTestId('preview-toolbar')).toBeInTheDocument();
  });

  it('renders the device toggle with all testids', async () => {
    await renderToolbar('running');
    expect(screen.getByTestId('preview-device-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('preview-device-desktop')).toBeInTheDocument();
    expect(screen.getByTestId('preview-device-mobile')).toBeInTheDocument();
  });

  it('url bar reload calls handle.navigate when running', async () => {
    await renderToolbar('running');
    fireEvent.click(screen.getByTestId('preview-url-reload'));
    expect(fakeHandle.navigate).toHaveBeenCalledWith('http://localhost:3000');
  });

  it('capture cluster has data-testid="preview-capture-cluster"', async () => {
    await renderToolbar('running');
    expect(screen.getByTestId('preview-capture-cluster')).toBeInTheDocument();
  });

  it('shows the green Run control when stopped and fires onRun', async () => {
    await renderToolbar('stopped');
    expect(screen.queryByTestId('preview-run-stop')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('preview-run-start'));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('shows Stop + Restart when running and fires the matching callbacks', async () => {
    await renderToolbar('running');
    expect(screen.queryByTestId('preview-run-start')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('preview-run-stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('preview-run-restart'));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
