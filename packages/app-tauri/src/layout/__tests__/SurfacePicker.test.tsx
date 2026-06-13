import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SurfacePicker } from '../SurfacePicker';

// Mock emitSurfaceIntent so we can assert what was emitted.
vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

import { emitSurfaceIntent } from '@/store/surface-intents';

describe('SurfacePicker (files surface)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the files picker when surface="files"', () => {
    render(<SurfacePicker surface="files" />);
    expect(screen.getByTestId('files-surface-picker')).toBeInTheDocument();
  });

  it('files-picker-open-file emits open-file-picker intent on click', async () => {
    const user = userEvent.setup();
    render(<SurfacePicker surface="files" />);
    await user.click(screen.getByTestId('files-picker-open-file'));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-file-picker' });
  });

  it('files-picker-view-changes emits inspector-tab intent with tab="changes" on click', async () => {
    const user = userEvent.setup();
    render(<SurfacePicker surface="files" />);
    await user.click(screen.getByTestId('files-picker-view-changes'));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'inspector-tab', tab: 'changes' });
  });
});

describe('SurfacePicker (run surface)', () => {
  it('renders the run picker when surface="run"', () => {
    render(<SurfacePicker surface="run" />);
    expect(screen.getByTestId('run-surface-picker')).toBeInTheDocument();
  });

  it('run-picker-new-terminal button is enabled', () => {
    render(<SurfacePicker surface="run" />);
    const btn = screen.getByTestId('run-picker-new-terminal');
    expect(btn).not.toBeDisabled();
  });
});
