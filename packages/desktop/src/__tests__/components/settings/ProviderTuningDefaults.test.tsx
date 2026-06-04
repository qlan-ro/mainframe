import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { AdapterModel, ProviderConfig } from '@qlan-ro/mainframe-types';
import { ProviderTuningDefaults } from '../../../renderer/components/settings/ProviderTuningDefaults';
import { CodexTuningDefaults } from '../../../renderer/components/settings/CodexTuningDefaults';

const fullModel: AdapterModel = {
  id: 'opus',
  label: 'Opus',
  supportedEfforts: ['low', 'high', 'xhigh'],
  supportsFast: true,
  supportsUltracode: true,
  supportsAdaptiveThinking: true,
};

const emptyConfig: ProviderConfig = {};

describe('ProviderTuningDefaults', () => {
  it('renders default-effort select + supported feature toggles, capability-gated', () => {
    render(
      <ProviderTuningDefaults
        adapterId="claude"
        model={fullModel}
        config={emptyConfig}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('providers-claude-default-effort')).toBeInTheDocument();
    expect(screen.getByTestId('providers-claude-default-feature-fast')).toBeInTheDocument();
    expect(screen.getByTestId('providers-claude-default-feature-ultracode')).toBeInTheDocument();
    expect(screen.getByTestId('providers-claude-default-feature-adaptiveThinking')).toBeInTheDocument();
  });

  it('does not render effort select when model has no supportedEfforts', () => {
    const modelNoEfforts: AdapterModel = { id: 'haiku', label: 'Haiku' };
    render(
      <ProviderTuningDefaults
        adapterId="claude"
        model={modelNoEfforts}
        config={emptyConfig}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('providers-claude-default-effort')).toBeNull();
  });

  it('does not render feature toggles when model has no capabilities', () => {
    const modelNoFeatures: AdapterModel = {
      id: 'basic',
      label: 'Basic',
      supportedEfforts: ['low', 'medium'],
    };
    render(
      <ProviderTuningDefaults
        adapterId="claude"
        model={modelNoFeatures}
        config={emptyConfig}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('providers-claude-default-feature-fast')).toBeNull();
    expect(screen.getByTestId('providers-claude-default-effort')).toBeInTheDocument();
  });
});

describe('CodexTuningDefaults', () => {
  it('shows personality + reasoning summary (no verbosity)', () => {
    const codexModel: AdapterModel = { id: 'gpt', label: 'GPT', supportsPersonality: true };
    render(
      <CodexTuningDefaults
        adapterId="codex"
        model={codexModel}
        config={emptyConfig}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('providers-codex-personality')).toBeInTheDocument();
    expect(screen.getByTestId('providers-codex-reasoning-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('providers-codex-verbosity')).toBeNull();
  });

  it('hides personality select when model does not supportsPersonality', () => {
    const modelNoPers: AdapterModel = { id: 'gpt-mini', label: 'GPT Mini' };
    render(
      <CodexTuningDefaults
        adapterId="codex"
        model={modelNoPers}
        config={emptyConfig}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('providers-codex-personality')).toBeNull();
    expect(screen.getByTestId('providers-codex-reasoning-summary')).toBeInTheDocument();
  });
});
