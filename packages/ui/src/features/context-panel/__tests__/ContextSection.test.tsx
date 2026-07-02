import { describe, expect, it } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
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

  it('renders the trailing node inside the header and omits the count badge', () => {
    render(
      <ContextSection icon={Globe} title="Tasks" trailing={<span data-testid="my-trailing">2/3</span>} defaultOpen>
        <div>child-row</div>
      </ContextSection>,
    );
    const header = screen.getByTestId('sidebar-context-section-tasks');
    expect(within(header).getByTestId('my-trailing')).toBeInTheDocument();
    expect(within(header).getByText('2/3')).toBeInTheDocument();
    expect(within(header).queryByText('3')).not.toBeInTheDocument();
  });

  it('renders the title as flex-none (not flex-1) when trailing is provided', () => {
    render(
      <ContextSection icon={Globe} title="Tasks" trailing={<span>2/3</span>} defaultOpen>
        <div>child-row</div>
      </ContextSection>,
    );
    const title = screen.getByText('Tasks');
    expect(title).toHaveClass('flex-none');
    expect(title).not.toHaveClass('flex-1');
  });

  it('renders the count badge with flex-1 title when only count is passed', () => {
    render(
      <ContextSection icon={Globe} title="Global" count={5} defaultOpen>
        <div>child-row</div>
      </ContextSection>,
    );
    const header = screen.getByTestId('sidebar-context-section-global');
    expect(within(header).getByText('5')).toBeInTheDocument();
    const title = screen.getByText('Global');
    expect(title).toHaveClass('flex-1');
    expect(title).not.toHaveClass('flex-none');
  });
});
