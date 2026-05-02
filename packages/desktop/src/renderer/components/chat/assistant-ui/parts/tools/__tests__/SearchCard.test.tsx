import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TooltipProvider } from '../../../../../ui/tooltip.js';
import { SearchCard } from '../SearchCard.js';

const wrap = (ui: React.ReactNode) => <TooltipProvider>{ui}</TooltipProvider>;

describe('SearchCard (U5 unified)', () => {
  it('renders the pattern in the subHeader (not header)', () => {
    const { getByText } = render(
      wrap(<SearchCard toolName="Grep" args={{ pattern: 'foo' }} result={undefined} isError={false} />),
    );
    expect(getByText(/"foo"/)).toBeTruthy();
  });

  it('appends path suffix when args.path is provided', () => {
    const { getByText } = render(
      wrap(
        <SearchCard toolName="Grep" args={{ pattern: 'foo', path: 'src/auth' }} result={undefined} isError={false} />,
      ),
    );
    expect(getByText(/in src\/auth/)).toBeTruthy();
  });

  it('does not render Maximize2 toggle', () => {
    const { container } = render(
      wrap(<SearchCard toolName="Grep" args={{ pattern: 'foo' }} result={{ content: 'no matches' }} isError={false} />),
    );
    expect(container.querySelector('svg.lucide-maximize-2')).toBeNull();
  });
});
