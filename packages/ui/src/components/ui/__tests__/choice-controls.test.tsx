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

describe('choice-control style contract', () => {
  it.each([
    ['Checkbox unchecked ring', <Checkbox data-testid="el" />, 'border-mf-text-4'],
    ['Checkbox disabled opacity', <Checkbox data-testid="el" disabled />, 'disabled:opacity-[0.45]'],
    [
      'RadioGroupItem unchecked ring',
      <RadioGroup>
        <RadioGroupItem data-testid="el" value="a" />
      </RadioGroup>,
      'border-mf-text-4',
    ],
    [
      'RadioGroupItem disabled opacity',
      <RadioGroup>
        <RadioGroupItem data-testid="el" value="a" disabled />
      </RadioGroup>,
      'disabled:opacity-[0.45]',
    ],
    ['Switch disabled opacity', <Switch data-testid="el" disabled />, 'disabled:opacity-[0.45]'],
    ['Label peer-disabled opacity', <Label data-testid="el">Field</Label>, 'peer-disabled:opacity-[0.45]'],
  ] as const)('%s', (_name, ui, expectedClass) => {
    render(ui);
    expect(screen.getByTestId('el').className).toContain(expectedClass);
  });
});
