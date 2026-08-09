/**
 * Button component unit tests.
 *
 * Contract being pinned (todo #316): the primitive must default to
 * `type="button"` so a Button dropped inside a real `<form>` never submits
 * by accident. An explicit `type` prop always wins, and the default must
 * not leak onto a slotted non-button element via `asChild`.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../button';

describe('Button', () => {
  it('defaults to type="button" when no type prop is given', () => {
    render(<Button data-testid="btn">Click</Button>);
    expect(screen.getByTestId('btn')).toHaveAttribute('type', 'button');
  });

  it('keeps an explicit type="submit" prop', () => {
    render(
      <Button type="submit" data-testid="btn">
        Submit
      </Button>,
    );
    expect(screen.getByTestId('btn')).toHaveAttribute('type', 'submit');
  });

  it('does not add a type attribute when asChild renders a non-button element', () => {
    render(
      <Button asChild>
        <a href="#" data-testid="link">
          Link
        </a>
      </Button>,
    );
    expect(screen.getByTestId('link')).not.toHaveAttribute('type');
  });
});
