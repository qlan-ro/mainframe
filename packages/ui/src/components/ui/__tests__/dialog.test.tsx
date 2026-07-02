/**
 * Dialog primitive style contract (audit area 3 — DirectoryPickerModal parity,
 * shared-primitive exception 3.9/3.10/3.21).
 *
 * Pins:
 *  - DialogTitle base uses text-heading (15px) so callers that don't override
 *    the size land on the design's 14-15px title, not text-body (3.9).
 *  - Close button is 26px/14px-icon/7px-radius (compressed-scale corrected
 *    per the verifier note, 3.10). Kept absolutely positioned — a true inline
 *    header-row reflow would require restructuring every DialogContent
 *    consumer's header markup, out of scope for this minimal fix.
 *  - No extra chrome beyond the artboard: DialogContent still carries the
 *    border/entrance-animation/backdrop-blur documented as systemic in 3.21
 *    (kept — this pins the CURRENT baseline, not a removal).
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dialog, DialogContent, DialogTitle } from '../dialog';

describe('DialogTitle', () => {
  it('defaults to the heading type scale (15px) when unclassed', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText('Title').className).toContain('text-heading');
  });
});

describe('DialogContent close button', () => {
  it('is 26px square with a 7px radius (compressed-scale corrected)', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const close = screen.getByTestId('dialog-close');
    expect(close.className).toContain('size-[26px]');
    expect(close.className).toContain('rounded-[7px]');
  });

  it('renders a 14px close icon', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const icon = screen.getByTestId('dialog-close').querySelector('svg');
    expect(icon?.getAttribute('class')).toContain('size-[14px]');
  });

  it('can still be hidden via hideClose', () => {
    render(
      <Dialog open>
        <DialogContent hideClose>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByTestId('dialog-close')).toBeNull();
  });
});
