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
});
