import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Globe } from 'lucide-react';
import { ContextSection } from '../ContextSection';

describe('ContextSection', () => {
  it('renders the title, count, and children when open by default', () => {
    render(
      <ContextSection icon={Globe} title="Global" count={2} defaultOpen>
        <div>child-row</div>
      </ContextSection>,
    );
    expect(screen.getByTestId('sidebar-context-section-global')).toHaveTextContent('Global');
    expect(screen.getByTestId('sidebar-context-section-global')).toHaveTextContent('2');
    expect(screen.getByText('child-row')).toBeInTheDocument();
  });

  it('renders with a 0 count and toggles children on header click', () => {
    render(
      <ContextSection icon={Globe} title="Session" count={0}>
        <div>hidden-row</div>
      </ContextSection>,
    );
    expect(screen.getByTestId('sidebar-context-section-session')).toHaveTextContent('0');
    expect(screen.queryByText('hidden-row')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sidebar-context-section-session'));
    expect(screen.getByText('hidden-row')).toBeInTheDocument();
  });
});
