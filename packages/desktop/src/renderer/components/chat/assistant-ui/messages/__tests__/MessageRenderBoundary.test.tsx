import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

vi.mock('../../../../../lib/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: mockWarn, error: vi.fn(), debug: vi.fn() }),
}));

import { MessageRenderBoundary } from '../MessageRenderBoundary.js';

function Thrower({ shouldThrow }: { shouldThrow: boolean }): React.ReactElement {
  if (shouldThrow) throw new Error('tapClientLookup: Index 469 out of bounds (length: 469)');
  return <span data-testid="thrower-output">content</span>;
}

beforeEach(() => {
  mockWarn.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('MessageRenderBoundary', () => {
  it('containment: catches child throw, renders null, sibling outside boundary is unaffected', () => {
    const { getByText, queryByTestId } = render(
      <div>
        <MessageRenderBoundary>
          <Thrower shouldThrow={true} />
        </MessageRenderBoundary>
        <div>sibling</div>
      </div>,
    );

    expect(getByText('sibling')).toBeTruthy();
    expect(queryByTestId('thrower-output')).toBeNull();
  });

  it('logging: calls log.warn with the thrown error message when a child throws', () => {
    render(
      <MessageRenderBoundary>
        <Thrower shouldThrow={true} />
      </MessageRenderBoundary>,
    );

    expect(mockWarn).toHaveBeenCalledWith(
      'message render failed',
      expect.objectContaining({ message: 'tapClientLookup: Index 469 out of bounds (length: 469)' }),
    );
  });

  it('auto-recovery: re-renders child normally after the error condition clears', () => {
    function Harness() {
      const [shouldThrow, setShouldThrow] = useState(true);
      return (
        <div>
          <button onClick={() => setShouldThrow(false)}>recover</button>
          <MessageRenderBoundary>
            <Thrower shouldThrow={shouldThrow} />
          </MessageRenderBoundary>
        </div>
      );
    }

    const { getByText, queryByTestId, getByRole } = render(<Harness />);

    // Initially throws → null
    expect(queryByTestId('thrower-output')).toBeNull();

    // Trigger re-render with non-throwing state
    fireEvent.click(getByRole('button', { name: 'recover' }));

    // componentDidUpdate resets hasError → child renders normally
    expect(getByText('content')).toBeTruthy();
    expect(queryByTestId('thrower-output')).not.toBeNull();
  });
});
