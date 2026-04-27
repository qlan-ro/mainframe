import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TooltipProvider } from '../../../../../ui/tooltip.js';
import { BashCard } from '../BashCard.js';

const wrap = (ui: React.ReactNode) => <TooltipProvider>{ui}</TooltipProvider>;

describe('BashCard (U1 unified)', () => {
  it('does not render the Maximize2 toggle icon', () => {
    const { container } = render(wrap(<BashCard args={{ command: 'ls' }} result={undefined} isError={false} />));
    expect(container.querySelector('svg.lucide-maximize-2, svg[class*="maximize"]')).toBeNull();
  });

  it('renders subHeader description when present', () => {
    const { getByText } = render(
      wrap(<BashCard args={{ command: 'ls', description: 'list files' }} result={undefined} isError={false} />),
    );
    expect(getByText('list files')).toBeTruthy();
  });
});
