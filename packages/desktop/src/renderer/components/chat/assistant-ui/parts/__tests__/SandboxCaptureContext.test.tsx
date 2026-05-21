import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SandboxCaptureContext } from '../SandboxCaptureContext.js';

describe('SandboxCaptureContext (metadata-only)', () => {
  it('renders nothing when rows is empty', () => {
    const { container } = render(<SandboxCaptureContext rows={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one row per capture with breadcrumb + annotation (no label prefix)', () => {
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
    expect(items[0]!.querySelectorAll('[data-testid="selector-crumb"]').length).toBe(3);
    expect(items[0]!.textContent).not.toContain('element1');
    expect(items[1]!.textContent).toBe('note here');
  });

  it('skips rows that have neither selector nor annotation', () => {
    render(
      <SandboxCaptureContext
        rows={[
          { label: 'screenshot1', imageName: 'screenshot1.png' },
          { label: 'element1', imageName: 'element1.png', selector: 'main > button.go' },
        ]}
      />,
    );
    expect(screen.getAllByTestId('capture-meta-row')).toHaveLength(1);
  });

  it('renders no <img> elements (images live in attachment renderers now)', () => {
    const { container } = render(
      <SandboxCaptureContext rows={[{ label: 'a', imageName: 'a.png', selector: 'div > p' }]} />,
    );
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });
});
