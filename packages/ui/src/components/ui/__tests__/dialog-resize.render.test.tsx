import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogTitle } from '../dialog';

describe('DialogContent resizeKey opt-in', () => {
  it('renders no grabber when resizeKey is absent — same DOM, no behavior change', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Plain dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByTestId(/^dialog-resize-grabber-/)).toBeNull();
  });

  it('renders a decorative, non-focusable grabber keyed by resizeKey when opted in', () => {
    render(
      <Dialog open>
        <DialogContent resizeKey="settings">
          <DialogTitle>Resizable dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const grabber = screen.getByTestId('dialog-resize-grabber-settings');
    expect(grabber).toHaveAttribute('aria-hidden');
    expect(grabber).toHaveAttribute('tabindex', '-1');
  });
});
