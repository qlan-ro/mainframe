import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TooltipProvider } from '../../../../../ui/tooltip.js';
import { EditFileCard } from '../EditFileCard.js';

const wrap = (ui: React.ReactNode) => <TooltipProvider>{ui}</TooltipProvider>;

describe('EditFileCard (U2 unified)', () => {
  it('renders FileTypeIcon and "Edit" label (no Pencil action icon)', () => {
    const { container, getByText } = render(
      wrap(
        <EditFileCard
          args={{ file_path: '/x/y/foo.ts', old_string: 'a', new_string: 'b' }}
          result={undefined}
          isError={false}
        />,
      ),
    );
    expect(container.querySelector('svg.lucide-pencil, svg[class*="pencil"]')).toBeNull();
    expect(getByText('Edit')).toBeTruthy();
  });

  it('does not render Maximize2 toggle icon', () => {
    const { container } = render(
      wrap(
        <EditFileCard
          args={{ file_path: '/x/y/foo.ts', old_string: 'a', new_string: 'b' }}
          result={undefined}
          isError={false}
        />,
      ),
    );
    expect(container.querySelector('svg.lucide-maximize-2, svg[class*="maximize"]')).toBeNull();
  });
});
