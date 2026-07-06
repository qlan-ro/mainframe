import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Switch } from '../switch';

describe('Switch', () => {
  it('renders a 38x22 track (h-[22px] w-[38px]) matching the design spec (05-settings.jsx SwToggle)', () => {
    const { container } = render(<Switch />);
    const root = container.querySelector('button[role="switch"]');
    expect(root?.className).toContain('h-[22px]');
    expect(root?.className).toContain('w-[38px]');
  });

  it('renders an 18x18 thumb with 16px travel', () => {
    const { container } = render(<Switch />);
    const thumb = container.querySelector('span[data-state]');
    expect(thumb?.className).toContain('size-[18px]');
    expect(thumb?.className).toContain('translate-x-[16px]');
  });

  it('keeps the disabled opacity set by area 16 (0.45) — must not regress', () => {
    const { container } = render(<Switch disabled />);
    const root = container.querySelector('button[role="switch"]');
    expect(root?.className).toContain('disabled:opacity-[0.45]');
  });
});
