/**
 * Choice-control primitive style contract (Checkbox / RadioGroupItem / Switch / Label).
 *
 * Pins two design-parity facts (audit area 16):
 *  - Unchecked ring uses the solid `border-mf-text-4` token, not the faint `border-border`
 *    hairline (16.1).
 *  - Disabled affordance is the app-wide `opacity-[0.45]` convention, not shadcn's stock
 *    `opacity-50` / `opacity-70` values (16.2).
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Checkbox } from '../checkbox';
import { RadioGroup, RadioGroupItem } from '../radio-group';
import { Switch } from '../switch';
import { Label } from '../label';

describe('Checkbox', () => {
  it('uses the solid text-4 token for the unchecked ring', () => {
    render(<Checkbox data-testid="cb" />);
    expect(screen.getByTestId('cb').className).toContain('border-mf-text-4');
  });

  it('uses the app-wide 0.45 disabled opacity convention', () => {
    render(<Checkbox data-testid="cb" disabled />);
    expect(screen.getByTestId('cb').className).toContain('disabled:opacity-[0.45]');
  });
});

describe('RadioGroupItem', () => {
  it('uses the solid text-4 token for the unchecked ring', () => {
    render(
      <RadioGroup>
        <RadioGroupItem data-testid="rb" value="a" />
      </RadioGroup>,
    );
    expect(screen.getByTestId('rb').className).toContain('border-mf-text-4');
  });

  it('uses the app-wide 0.45 disabled opacity convention', () => {
    render(
      <RadioGroup>
        <RadioGroupItem data-testid="rb" value="a" disabled />
      </RadioGroup>,
    );
    expect(screen.getByTestId('rb').className).toContain('disabled:opacity-[0.45]');
  });
});

describe('Switch', () => {
  it('uses the app-wide 0.45 disabled opacity convention', () => {
    render(<Switch data-testid="sw" disabled />);
    expect(screen.getByTestId('sw').className).toContain('disabled:opacity-[0.45]');
  });
});

describe('Label', () => {
  it('uses the app-wide 0.45 disabled opacity convention when its peer is disabled', () => {
    render(<Label data-testid="lbl">Field</Label>);
    expect(screen.getByTestId('lbl').className).toContain('peer-disabled:opacity-[0.45]');
  });
});
