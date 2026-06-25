import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: vi.fn() }));
// The run picker resolves launch configs; stub the launch subsystem + its context deps.
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: 'proj-1', chatId: 'chat-1' }),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));
vi.mock('@/features/run/use-launch-actions', () => ({
  useLaunchActions: () => ({
    configs: [],
    scopeStatuses: {},
    selectedConfigName: null,
    handleSelect: vi.fn(),
    handleLaunch: vi.fn(),
    handleStop: vi.fn(),
    refetch: vi.fn(),
  }),
}));
import { emitSurfaceIntent } from '@/store/surface-intents';
import { SurfacePicker } from '../SurfacePicker';

describe('SurfacePicker (run terminal row)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the new-terminal row is enabled', () => {
    render(<SurfacePicker surface="run" />);
    expect(screen.getByTestId('run-picker-new-terminal')).not.toBeDisabled();
  });

  it('clicking it emits a new-terminal intent', async () => {
    const user = userEvent.setup();
    render(<SurfacePicker surface="run" />);
    await user.click(screen.getByTestId('run-picker-new-terminal'));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'new-terminal' });
  });
});
