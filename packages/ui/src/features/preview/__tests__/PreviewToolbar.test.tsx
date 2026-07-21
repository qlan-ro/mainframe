/**
 * PreviewToolbar — unit tests.
 *
 * Behaviors covered:
 *  - Clicking a device-toggle button forwards the device to onDeviceChange
 *  - Reload button calls handle.navigate when running
 *  - Clicking a capture-cluster button forwards to onCaptureClick
 *  - Run/Stop primary control reflects status and fires the right callback
 *
 * (Bare "toolbar renders" / "device toggle renders" / "capture cluster
 * renders" presence smokes were dropped or upgraded to interaction tests —
 * clicking through each cluster's real testid is strictly stronger proof
 * that PreviewToolbar wires it correctly.)
 */
import { it, expect, vi, describe, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { LaunchProcessStatus, PreviewHandle } from '@qlan-ro/mainframe-types';

const onRun = vi.fn();
const onStop = vi.fn();
const onRestart = vi.fn();
const onDeviceChange = vi.fn();
const onCaptureClick = vi.fn();

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
      onDeviceChange={onDeviceChange}
      onRun={onRun}
      onStop={onStop}
      onRestart={onRestart}
      inspectActive={false}
      onCaptureClick={onCaptureClick}
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
      compositesAboveDom: true,
      navigate: vi.fn().mockResolvedValue(undefined),
      capture: vi.fn().mockResolvedValue(new Uint8Array()),
      startInspect: vi.fn().mockResolvedValue(undefined),
      onInspect: vi.fn().mockReturnValue(() => {}),
      startRegionSelect: vi.fn().mockResolvedValue(undefined),
      onRegionSelect: vi.fn().mockReturnValue(() => {}),
      onNavigate: vi.fn().mockReturnValue(() => {}),
      refit: vi.fn(),
      setDevice: vi.fn(),
      destroy: vi.fn(),
    };
    onRun.mockReset();
    onStop.mockReset();
    onRestart.mockReset();
    onDeviceChange.mockReset();
    onCaptureClick.mockReset();
  });

  it('clicking the mobile device-toggle button calls onDeviceChange("mobile")', async () => {
    await renderToolbar('running');
    fireEvent.click(screen.getByTestId('preview-device-mobile'));
    expect(onDeviceChange).toHaveBeenCalledWith('mobile');
  });

  it('url bar reload calls handle.navigate when running', async () => {
    await renderToolbar('running');
    fireEvent.click(screen.getByTestId('preview-url-reload'));
    expect(fakeHandle.navigate).toHaveBeenCalledWith('http://localhost:3000');
  });

  it('clicking the capture-cluster capture button calls onCaptureClick', async () => {
    await renderToolbar('running');
    fireEvent.click(screen.getByTestId('preview-toolbar-capture'));
    expect(onCaptureClick).toHaveBeenCalledTimes(1);
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
