import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ProviderConfig } from '@qlan-ro/mainframe-types';
import { CodexTuningDefaults } from '../CodexTuningDefaults';

const config = {} as ProviderConfig;

describe('CodexTuningDefaults', () => {
  it('selecting a reasoning summary option emits the config update', () => {
    const onChange = vi.fn();
    render(<CodexTuningDefaults adapterId="codex" config={config} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('settings-codex-reasoning-summary'));
    fireEvent.click(screen.getByTestId('settings-codex-reasoning-summary-option-concise'));
    expect(onChange).toHaveBeenCalledWith({ reasoningSummary: 'concise' });
  });
});
