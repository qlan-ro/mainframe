import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CodeHeader } from '../CodeHeader';

describe('CodeHeader (U13)', () => {
  it('does not draw a divider line below the header', () => {
    const { container } = render(<CodeHeader language="ts" code="const x = 1" />);
    const header = container.firstChild as HTMLElement;
    expect(header.className).not.toMatch(/border-b/);
  });

  it('does not use the lighter bg-mf-hover background', () => {
    const { container } = render(<CodeHeader language="ts" code="const x = 1" />);
    const header = container.firstChild as HTMLElement;
    expect(header.className).not.toMatch(/bg-mf-hover/);
  });

  it('still renders language label and copy button', () => {
    const { getByText, getByRole } = render(<CodeHeader language="ts" code="const x = 1" />);
    expect(getByText('ts')).toBeTruthy();
    expect(getByRole('button')).toBeTruthy();
  });
});
