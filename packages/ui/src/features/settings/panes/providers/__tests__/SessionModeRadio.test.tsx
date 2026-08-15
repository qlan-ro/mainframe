import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AdapterInfo, ProviderConfig } from '@qlan-ro/mainframe-types';
import { SessionModeRadio } from '../SessionModeRadio';

const config = {} as ProviderConfig;

function adapterWith(capabilities: Record<string, boolean>): AdapterInfo {
  return { id: 'claude', label: 'Claude', capabilities, models: [] } as unknown as AdapterInfo;
}

const withAuto = adapterWith({ planMode: true, autoMode: true });
const withoutAuto = adapterWith({ planMode: true, autoMode: false });
const capabilitiesOmitAuto = adapterWith({ planMode: true });

describe('SessionModeRadio', () => {
  it('offers Auto when the adapter advertises the capability', () => {
    render(<SessionModeRadio adapterId="claude" adapter={withAuto} config={config} onChange={vi.fn()} />);
    expect(screen.getByTestId('settings-claude-mode-option-auto')).toBeTruthy();
  });

  it('hides Auto when the adapter reports autoMode: false', () => {
    render(<SessionModeRadio adapterId="claude" adapter={withoutAuto} config={config} onChange={vi.fn()} />);
    expect(screen.queryByTestId('settings-claude-mode-option-auto')).toBeNull();
  });

  it('hides Auto when the capabilities object omits the key entirely', () => {
    render(<SessionModeRadio adapterId="claude" adapter={capabilitiesOmitAuto} config={config} onChange={vi.fn()} />);
    expect(screen.queryByTestId('settings-claude-mode-option-auto')).toBeNull();
  });

  it('tints Auto as a caution and keeps the destructive treatment for Unattended', () => {
    render(<SessionModeRadio adapterId="claude" adapter={withAuto} config={config} onChange={vi.fn()} />);
    const auto = screen.getByTestId('settings-claude-mode-option-auto');
    expect(auto.className).toContain('border-warning/50');
    // The primitive's own base classes carry aria-invalid destructive rings, so
    // pin the tone classes the row adds rather than the substring.
    expect(auto.className).not.toContain('border-destructive/50');
    expect(auto.className).not.toContain('text-destructive');
    const autoLabel = auto.closest('label')?.querySelector('span');
    expect(autoLabel?.className).toContain('text-warning');

    const yolo = screen.getByTestId('settings-claude-mode-option-yolo');
    expect(yolo.className).toContain('border-destructive/50');
    const yoloLabel = yolo.closest('label')?.querySelector('span');
    expect(yoloLabel?.className).toContain('text-destructive');
  });

  it('leaves the Auto description on the muted ink, like the destructive row', () => {
    render(<SessionModeRadio adapterId="claude" adapter={withAuto} config={config} onChange={vi.fn()} />);
    const description = screen.getByTestId('settings-claude-mode-option-auto').closest('label')?.querySelector('p');
    expect(description?.className).toContain('text-muted-foreground');
    expect(description?.textContent).toBe('Claude decides which actions need approval');
  });

  it('selecting Auto emits the config update', () => {
    const onChange = vi.fn();
    render(<SessionModeRadio adapterId="claude" adapter={withAuto} config={config} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('settings-claude-mode-option-auto'));
    expect(onChange).toHaveBeenCalledWith({ defaultMode: 'auto' });
  });
});
