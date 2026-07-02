import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FilesTabStrip } from '../FilesTabStrip';

// Mock emitSurfaceIntent so we can assert what was emitted.
vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

import { emitSurfaceIntent } from '@/store/surface-intents';

describe('FilesTabStrip — add button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('files-tab-strip-add emits the open-file-picker intent on click', async () => {
    const user = userEvent.setup();
    render(<FilesTabStrip />);
    await user.click(screen.getByTestId('files-tab-strip-add'));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-file-picker' });
  });
});

describe('FilesTabStrip — strip height', () => {
  it('has the fixed h-[36px] height class (uniform SurfaceTabStrip height, 15.5)', () => {
    render(<FilesTabStrip />);
    expect(screen.getByTestId('files-tab-strip')).toHaveClass('h-[36px]');
  });
});
