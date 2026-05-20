import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SandboxCaptureContext } from '../SandboxCaptureContext.js';

describe('SandboxCaptureContext (metadata-only)', () => {
  it('renders nothing when rows is empty', () => {
    const { container } = render(<SandboxCaptureContext rows={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one row per capture with name, breadcrumb, and annotation', () => {
    render(
      <SandboxCaptureContext
        rows={[
          { label: 'element1', imageName: 'element1.png', selector: 'main > div > button.go' },
          { label: 'screenshot1', imageName: 'screenshot1.png', annotation: 'note here' },
        ]}
      />,
    );
    const items = screen.getAllByTestId('capture-meta-row');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('element1');
    expect(items[0]!.querySelectorAll('[data-testid="selector-crumb"]').length).toBe(3);
    expect(items[1]!.textContent).toContain('screenshot1');
    expect(items[1]!.textContent).toContain('note here');
  });

  it('renders no <img> elements (images live in attachment renderers now)', () => {
    const { container } = render(
      <SandboxCaptureContext rows={[{ label: 'a', imageName: 'a.png', selector: 'div > p' }]} />,
    );
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });
});
