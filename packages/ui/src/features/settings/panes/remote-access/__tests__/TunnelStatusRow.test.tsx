import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { TunnelStatusRow } from '../TunnelStatusRow';

describe('TunnelStatusRow', () => {
  it('renders the arrow.clockwise-mapped lucide RotateCw glyph for the loading spinner, not Loader2', () => {
    const { container } = render(<TunnelStatusRow state="starting" url={null} onRetryVerify={vi.fn()} />);
    // arrow.clockwise → lucide RotateCw per the icon-mapping guidance (finding 14.19).
    expect(container.querySelector('.lucide-rotate-cw')).not.toBeNull();
    expect(container.querySelector('.lucide-loader-circle')).toBeNull();
  });
});
