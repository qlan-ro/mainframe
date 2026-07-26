/**
 * StatusDot testid/state coverage — e2e-blocking wiring debt (tool-cards-report.md):
 * the tri-state dot had no data-testid, blocking a class-name-free assertion of
 * pending/error/success state on every tool card.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusDot, ClickableFilePath } from '../chrome';
import { TooltipProvider } from '@/components/ui/tooltip';

describe('StatusDot — data-testid + data-status', () => {
  it('renders data-status="pending" while the tool call is still in flight (result undefined)', () => {
    render(<StatusDot result={undefined} isError={undefined} />);
    const dot = screen.getByTestId('tool-card-status-dot');
    expect(dot).toHaveAttribute('data-status', 'pending');
  });

  it('renders data-status="error" when the tool call finished with isError', () => {
    render(<StatusDot result={{}} isError={true} />);
    expect(screen.getByTestId('tool-card-status-dot')).toHaveAttribute('data-status', 'error');
  });

  it('renders data-status="success" when the tool call finished without error', () => {
    render(<StatusDot result={{}} isError={false} />);
    expect(screen.getByTestId('tool-card-status-dot')).toHaveAttribute('data-status', 'success');
  });
});

describe('ClickableFilePath — data-file-path', () => {
  it('exposes the same raw filePath passed to openFile(), not the shortened label', () => {
    const filePath = '/Users/doru/projects/myapp/src/deep/nested/module.ts';
    render(
      <TooltipProvider>
        <ClickableFilePath filePath={filePath} />
      </TooltipProvider>,
    );
    const pill = screen.getByTestId('tool-card-file-path');
    expect(pill).toHaveAttribute('data-file-path', filePath);
    expect(pill.textContent).toBe('nested/module.ts');
  });
});
