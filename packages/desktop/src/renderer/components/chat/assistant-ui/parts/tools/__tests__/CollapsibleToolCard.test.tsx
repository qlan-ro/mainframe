import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CollapsibleToolCard } from '../CollapsibleToolCard.js';
import { TooltipProvider } from '../../../../../ui/tooltip.js';

describe('CollapsibleToolCard', () => {
  it('renders the toggle icon by default', () => {
    render(
      <TooltipProvider>
        <CollapsibleToolCard header={<span>hdr</span>}>
          <div>body</div>
        </CollapsibleToolCard>
      </TooltipProvider>,
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(document.querySelector('svg.lucide-maximize-2, svg[class*="maximize"]')).toBeTruthy();
  });

  it('hides the toggle icon when hideToggle=true', () => {
    render(
      <TooltipProvider>
        <CollapsibleToolCard header={<span>hdr</span>} hideToggle>
          <div>body</div>
        </CollapsibleToolCard>
      </TooltipProvider>,
    );
    expect(document.querySelector('svg.lucide-maximize-2, svg[class*="maximize"]')).toBeNull();
    expect(document.querySelector('svg.lucide-minimize-2, svg[class*="minimize"]')).toBeNull();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders subHeader when collapsed AND when expanded', () => {
    const { rerender } = render(
      <TooltipProvider>
        <CollapsibleToolCard header={<span>hdr</span>} subHeader={<span data-testid="sub">sub</span>}>
          <div>body</div>
        </CollapsibleToolCard>
      </TooltipProvider>,
    );
    // Collapsed (default): subHeader visible
    expect(screen.getByTestId('sub')).toBeInTheDocument();

    // Re-render with defaultOpen — should be expanded
    rerender(
      <TooltipProvider>
        <CollapsibleToolCard defaultOpen header={<span>hdr</span>} subHeader={<span data-testid="sub">sub</span>}>
          <div>body</div>
        </CollapsibleToolCard>
      </TooltipProvider>,
    );
    expect(screen.getByTestId('sub')).toBeInTheDocument();
  });
});
