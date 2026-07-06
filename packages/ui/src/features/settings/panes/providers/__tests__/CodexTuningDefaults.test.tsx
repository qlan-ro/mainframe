import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ProviderConfig } from '@qlan-ro/mainframe-types';
import { CodexTuningDefaults } from '../CodexTuningDefaults';

const config = {} as ProviderConfig;

describe('CodexTuningDefaults', () => {
  it('sizes the Reasoning Summary SelectTrigger to the pane 30px/11px control height (matches ModelDropdown)', () => {
    render(<CodexTuningDefaults adapterId="codex" config={config} onChange={vi.fn()} />);
    const trigger = screen.getByTestId('settings-codex-reasoning-summary');
    expect(trigger.className).toContain('h-[30px]');
    expect(trigger.className).toContain('px-[11px]');
    expect(trigger.className).toContain('border-input');
    expect(trigger.className).not.toMatch(/(?:^|\s)h-8(?:\s|$)/);
  });
});
