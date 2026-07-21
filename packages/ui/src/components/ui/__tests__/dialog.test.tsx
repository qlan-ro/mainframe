/**
 * Dialog primitive style contract (audit area 3 — DirectoryPickerModal parity,
 * shared-primitive exception 3.9/3.10/3.21).
 *
 * Pins:
 *  - DialogTitle base uses text-heading (15px) so callers that don't override
 *    the size land on the design's 14-15px title, not text-body (3.9).
 *  - Close button is 26px/14px-icon/7px-radius (compressed-scale corrected
 *    per the verifier note, 3.10).
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dialog, DialogContent, DialogTitle } from '../dialog';

describe('Dialog primitives', () => {
  it('pins the title scale and 26px/14px-icon/7px-radius close button', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText('Title').className).toContain('text-heading');
    const close = screen.getByTestId('dialog-close');
    expect(close.className).toContain('size-[26px]');
    expect(close.className).toContain('rounded-[7px]');
    expect(close.querySelector('svg')?.getAttribute('class')).toContain('size-[14px]');
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
