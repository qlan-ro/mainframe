import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TooltipProvider } from '../../../../../ui/tooltip.js';
import { ReadFileCard } from '../ReadFileCard.js';

const wrap = (ui: React.ReactNode) => <TooltipProvider>{ui}</TooltipProvider>;

describe('ReadFileCard (U4 unified)', () => {
  it('renders FileText icon (not Eye) and "Read" label', () => {
    const { container, getByText } = render(
      wrap(<ReadFileCard args={{ file_path: '/x/foo.ts' }} result={{ content: 'hello' }} isError={false} />),
    );
    expect(container.querySelector('svg.lucide-eye')).toBeNull();
    expect(container.querySelector('svg.lucide-file-text, svg[class*="file-text"]')).toBeTruthy();
    expect(getByText('Read')).toBeTruthy();
  });

  it('does not render Maximize2 toggle', () => {
    const { container } = render(
      wrap(<ReadFileCard args={{ file_path: '/x/foo.ts' }} result={{ content: 'hi' }} isError={false} />),
    );
    expect(container.querySelector('svg.lucide-maximize-2')).toBeNull();
  });
});
