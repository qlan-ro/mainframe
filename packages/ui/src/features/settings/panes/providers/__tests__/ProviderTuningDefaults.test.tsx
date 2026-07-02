import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AdapterModel, ProviderConfig } from '@qlan-ro/mainframe-types';
import { ProviderTuningDefaults } from '../ProviderTuningDefaults';

const model: AdapterModel = {
  id: 'test-model',
  label: 'Test Model',
  supportedEfforts: ['low', 'medium', 'high'],
};

const config = {} as ProviderConfig;

describe('ProviderTuningDefaults', () => {
  it('sizes the Default Effort SelectTrigger to the pane 30px/11px control height (matches ModelDropdown)', () => {
    render(<ProviderTuningDefaults adapterId="claude" model={model} config={config} onChange={vi.fn()} />);
    const trigger = screen.getByTestId('settings-claude-default-effort');
    expect(trigger.className).toContain('h-[30px]');
    expect(trigger.className).toContain('px-[11px]');
    expect(trigger.className).toContain('border-input');
    expect(trigger.className).not.toMatch(/(?:^|\s)h-8(?:\s|$)/);
  });
});
