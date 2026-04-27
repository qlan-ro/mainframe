import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TooltipProvider } from '../../../../../ui/tooltip.js';
import { WriteFileCard } from '../WriteFileCard.js';

const wrap = (ui: React.ReactNode) => <TooltipProvider>{ui}</TooltipProvider>;

describe('WriteFileCard (U3 unified)', () => {
  it('renders both Pencil action icon and FileTypeIcon', () => {
    const { container } = render(
      wrap(
        <WriteFileCard
          args={{ file_path: '/x/y/foo.ts', content: 'hello\nworld' }}
          result={undefined}
          isError={false}
        />,
      ),
    );
    expect(container.querySelector('svg.lucide-pencil, svg[class*="pencil"]')).toBeTruthy();
  });

  it('does not render Maximize2 toggle icon', () => {
    const { container } = render(
      wrap(
        <WriteFileCard
          args={{ file_path: '/x/y/foo.ts', content: 'hello\nworld' }}
          result={undefined}
          isError={false}
        />,
      ),
    );
    expect(container.querySelector('svg.lucide-maximize-2, svg[class*="maximize"]')).toBeNull();
  });
});
