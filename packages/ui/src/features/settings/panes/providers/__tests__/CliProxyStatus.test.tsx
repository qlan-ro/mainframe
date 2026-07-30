import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AdapterModel, ProviderConfig } from '@qlan-ro/mainframe-types';
import { CliProxyStatus } from '../CliProxyStatus';

const SONNET: AdapterModel = { id: 'sonnet', label: 'Claude Sonnet 4' };
const PROXY_SOL: AdapterModel = { id: 'cliproxy/gpt-5.6-sol', label: 'gpt-5.6-sol', group: 'CLIProxyAPI' };
const PROXY_MINI: AdapterModel = { id: 'cliproxy/gpt-5.4-mini', label: 'gpt-5.4-mini', group: 'CLIProxyAPI' };

const EMPTY = {} as ProviderConfig;

function renderStatus(models: AdapterModel[], config: ProviderConfig = EMPTY) {
  const onChange = vi.fn();
  render(<CliProxyStatus adapterId="claude" models={models} config={config} onChange={onChange} />);
  return { onChange };
}

describe('CliProxyStatus', () => {
  it('counts the grouped models when the proxy answered the last probe', () => {
    renderStatus([SONNET, PROXY_SOL, PROXY_MINI]);
    expect(screen.getByTestId('settings-claude-cliproxy-status').textContent).toBe('2 models available');
  });

  it('reports "Not detected" and hides the override when no grouped model is present', () => {
    renderStatus([SONNET]);
    expect(screen.getByTestId('settings-claude-cliproxy-status').textContent).toBe('Not detected');
    expect(screen.queryByTestId('settings-claude-cliproxy-small-fast-model')).toBeNull();
  });

  it('emits the background model as a bare id, without the endpoint namespace', () => {
    const { onChange } = renderStatus([PROXY_SOL, PROXY_MINI]);
    fireEvent.click(screen.getByTestId('settings-claude-cliproxy-small-fast-model'));
    fireEvent.click(screen.getByTestId('settings-claude-cliproxy-small-fast-model-option-cliproxy/gpt-5.4-mini'));
    expect(onChange).toHaveBeenCalledWith({ cliproxySmallFastModel: 'gpt-5.4-mini' });
  });

  it('clears the override with the empty sentinel when Auto is chosen', () => {
    const { onChange } = renderStatus([PROXY_SOL], { cliproxySmallFastModel: 'gpt-5.6-sol' } as ProviderConfig);
    fireEvent.click(screen.getByTestId('settings-claude-cliproxy-small-fast-model'));
    fireEvent.click(screen.getByTestId('settings-claude-cliproxy-small-fast-model-option-auto'));
    expect(onChange).toHaveBeenCalledWith({ cliproxySmallFastModel: '' });
  });
});
