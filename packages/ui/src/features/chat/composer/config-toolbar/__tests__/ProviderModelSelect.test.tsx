/**
 * ProviderModelSelect — unit tests for the unified provider+model picker.
 *
 * Strategy:
 *  - Render the real component inside a TooltipProvider (the component nests
 *    PopoverTrigger inside a TooltipTrigger and needs the provider to avoid
 *    warnings and hydration errors in jsdom).
 *  - Open the Popover by clicking the trigger (`composer-model-select`); Radix
 *    Popover in jsdom renders the portal inline under the document body, so
 *    queries via `screen.findByTestId` / `screen.getByTestId` work immediately
 *    after `userEvent.click` settles.
 *  - All expected values (ids, labels, text) are literal constants — none are
 *    derived from the same logic the component uses.
 *
 * Behaviors covered:
 *  1. Trigger shows the current model's label ("Claude Sonnet 4")
 *  2. Opening the popover renders one provider pill per adapter and one model
 *     row per model (by their exact data-testid values)
 *  3. An uninstalled adapter's pill is disabled
 *  4. locked=true renders the footer ("Provider stays fixed for this session.")
 *     and disables non-active provider pills; locked=false omits the footer
 *  5. Clicking a model row calls setModel with that model's literal id
 *  6. Clicking an installed, non-active provider pill calls setAdapter with
 *     that adapter's id
 *  7. A model with isDefault=true includes "default" in its row text
 *  8. disabled=true (mid-turn) disables the trigger and blocks the popover
 *     from opening, matching the effort/features controls' running-inertness
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@v2/components/ui/tooltip';
import { ProviderModelSelect, type ProviderModelSelectProps } from '../ProviderModelSelect';
import type { AdapterInfo, AdapterModel, Chat, EffortLevel, FeatureKey } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal Chat — only the fields the component reads: adapterId + model. */
function makeChat(overrides?: { adapterId?: string; model?: string }): Chat {
  return {
    id: 'chat-test',
    adapterId: overrides?.adapterId ?? 'claude',
    projectId: 'proj-1',
    status: 'active',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    model: overrides?.model,
  };
}

const SONNET: AdapterModel = {
  id: 'sonnet',
  label: 'Claude Sonnet 4',
  description: 'Smart model',
  isDefault: true,
};

const HAIKU: AdapterModel = {
  id: 'haiku',
  label: 'Claude Haiku 4',
  description: 'Fast model',
  isDefault: false,
};

const ADAPTER_CLAUDE: AdapterInfo = {
  id: 'claude',
  name: 'Claude',
  description: 'Anthropic Claude',
  installed: true,
  models: [SONNET, HAIKU],
  capabilities: { planMode: true },
};

const ADAPTER_GEMINI: AdapterInfo = {
  id: 'gemini',
  name: 'Gemini',
  description: 'Google Gemini',
  installed: true,
  models: [{ id: 'gemini-flash', label: 'Gemini Flash' }],
  capabilities: { planMode: false },
};

const ADAPTER_CODEX_UNINSTALLED: AdapterInfo = {
  id: 'codex',
  name: 'Codex',
  description: 'OpenAI Codex',
  installed: false,
  models: [],
  capabilities: { planMode: false },
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

interface RenderProps {
  chat?: Chat;
  adapters?: AdapterInfo[];
  adapter?: AdapterInfo | null;
  model?: AdapterModel | null;
  locked?: boolean;
  disabled?: boolean;
  setAdapter?: (id: string) => void;
  setModel?: (id: string) => void;
  setModelTuning?: ProviderModelSelectProps['setModelTuning'];
  setEffort?: (effort: EffortLevel) => void;
  setFeature?: (key: FeatureKey, on: boolean) => void;
}

function renderSelect(props: RenderProps = {}) {
  const setAdapter = props.setAdapter ?? vi.fn();
  const setModel = props.setModel ?? vi.fn();
  const setModelTuning = props.setModelTuning ?? vi.fn();
  const setEffort = props.setEffort ?? vi.fn();
  const setFeature = props.setFeature ?? vi.fn();
  const chat = props.chat ?? makeChat({ adapterId: 'claude', model: 'sonnet' });
  const adapters = props.adapters ?? [ADAPTER_CLAUDE];
  const adapter = props.adapter !== undefined ? props.adapter : ADAPTER_CLAUDE;
  const model = props.model !== undefined ? props.model : SONNET;
  const locked = props.locked ?? false;
  const disabled = props.disabled ?? false;

  render(
    <TooltipProvider>
      <ProviderModelSelect
        chat={chat}
        adapters={adapters}
        adapter={adapter}
        model={model}
        locked={locked}
        disabled={disabled}
        setAdapter={setAdapter}
        setModel={setModel}
        setModelTuning={setModelTuning}
        setEffort={setEffort}
        setFeature={setFeature}
      />
    </TooltipProvider>,
  );

  return { setAdapter, setModel, setModelTuning, setEffort, setFeature };
}

// ---------------------------------------------------------------------------
// 1. Trigger label shows the current model's label
// ---------------------------------------------------------------------------

describe('ProviderModelSelect — trigger shows current model label', () => {
  it('renders the trigger with the current model label "Claude Sonnet 4"', () => {
    renderSelect({
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
      model: SONNET,
    });

    const trigger = screen.getByTestId('composer-model-select');
    expect(trigger).toBeInTheDocument();
    expect(trigger.textContent).toContain('Claude Sonnet 4');
  });
});

// ---------------------------------------------------------------------------
// 2. Opening the popover shows one pill per adapter + one row per model
// ---------------------------------------------------------------------------

describe('ProviderModelSelect — popover contents after open', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a provider pill for each adapter by data-testid', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE, ADAPTER_GEMINI],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    expect(screen.getByTestId('composer-adapter-select-option-claude')).toBeInTheDocument();
    expect(screen.getByTestId('composer-adapter-select-option-gemini')).toBeInTheDocument();
  });

  it('renders a model row for each model in the active adapter by data-testid', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    expect(screen.getByTestId('composer-model-select-option-sonnet')).toBeInTheDocument();
    expect(screen.getByTestId('composer-model-select-option-haiku')).toBeInTheDocument();
  });

  it('shows the check glyph on the active model row only', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    const check = (testId: string) =>
      screen.getByTestId(testId).querySelector('svg.lucide-check')?.getAttribute('class') ?? '';
    expect(check('composer-model-select-option-sonnet')).not.toContain('invisible');
    expect(check('composer-model-select-option-haiku')).toContain('invisible');
  });
});

// ---------------------------------------------------------------------------
// 3. Uninstalled adapter pill is disabled
// ---------------------------------------------------------------------------

describe('ProviderModelSelect — uninstalled adapter pill is disabled', () => {
  it('the uninstalled adapter pill has the disabled attribute', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE, ADAPTER_CODEX_UNINSTALLED],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    expect(screen.getByTestId('composer-adapter-select-option-codex')).toBeDisabled();
  });

  it('the installed adapter pill is NOT disabled when unlocked', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE, ADAPTER_GEMINI],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      locked: false,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    expect(screen.getByTestId('composer-adapter-select-option-gemini')).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 4. locked=true shows the footer and disables non-active provider pills;
//    locked=false omits the footer
// ---------------------------------------------------------------------------

describe('ProviderModelSelect — locked prop controls footer and pill state', () => {
  beforeEach(() => vi.clearAllMocks());

  it('locked=true renders the provider footer with its fixed text', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE, ADAPTER_GEMINI],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      locked: true,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    const footer = screen.getByTestId('composer-provider-footer');
    expect(footer).toBeInTheDocument();
    expect(footer.textContent).toBe('Provider stays fixed for this session.');
  });

  it('locked=true disables a non-active installed provider pill', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE, ADAPTER_GEMINI],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      locked: true,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    // gemini is installed but not active — should be disabled when locked
    expect(screen.getByTestId('composer-adapter-select-option-gemini')).toBeDisabled();
  });

  it('locked=true explains itself: the locked segment carries a tooltip, the active one does not', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE, ADAPTER_GEMINI],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      locked: true,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    // A disabled button swallows pointer events, so the tooltip rides on a
    // wrapper span around the locked segment only.
    expect(screen.getByTestId('composer-adapter-locked-gemini')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-adapter-locked-claude')).toBeNull();
  });

  it('locked=false renders no tooltip wrapper on any segment', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE, ADAPTER_GEMINI],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      locked: false,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    expect(screen.queryByTestId('composer-adapter-locked-gemini')).toBeNull();
  });

  it('locked=true does NOT disable the active provider pill', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE, ADAPTER_GEMINI],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      locked: true,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    // claude is the active adapter — its pill should remain enabled
    expect(screen.getByTestId('composer-adapter-select-option-claude')).not.toBeDisabled();
  });

  it('locked=false renders the footer with the unlocked hint text', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE, ADAPTER_GEMINI],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      locked: false,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    const footer = screen.getByTestId('composer-provider-footer');
    expect(footer).toBeInTheDocument();
    expect(footer.textContent).toBe('Pick a provider before your first message.');
  });
});

// ---------------------------------------------------------------------------
// 5. Clicking a model row calls setModel with that model's literal id
// ---------------------------------------------------------------------------

describe('ProviderModelSelect — clicking a model row calls setModel', () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls setModel('haiku') when the haiku row is clicked", async () => {
    const setModel = vi.fn();
    renderSelect({
      adapters: [ADAPTER_CLAUDE],
      adapter: ADAPTER_CLAUDE,
      // sonnet is the current model; clicking haiku should fire setModel('haiku')
      model: SONNET,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
      setModel,
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));
    await userEvent.click(screen.getByTestId('composer-model-select-option-haiku'));

    expect(setModel).toHaveBeenCalledExactlyOnceWith('haiku');
  });

  it('does NOT call setModel when the already-active model row is clicked', async () => {
    const setModel = vi.fn();
    renderSelect({
      adapters: [ADAPTER_CLAUDE],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
      setModel,
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));
    // Click the currently-active model (sonnet)
    await userEvent.click(screen.getByTestId('composer-model-select-option-sonnet'));

    expect(setModel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. Clicking a non-active, installed provider pill calls setAdapter
// ---------------------------------------------------------------------------

describe('ProviderModelSelect — clicking a provider pill calls setAdapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls setAdapter('gemini') when the gemini pill is clicked", async () => {
    const setAdapter = vi.fn();
    renderSelect({
      adapters: [ADAPTER_CLAUDE, ADAPTER_GEMINI],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      locked: false,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
      setAdapter,
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));
    await userEvent.click(screen.getByTestId('composer-adapter-select-option-gemini'));

    expect(setAdapter).toHaveBeenCalledExactlyOnceWith('gemini');
  });

  it('does NOT call setAdapter when the already-active provider pill is clicked', async () => {
    const setAdapter = vi.fn();
    renderSelect({
      adapters: [ADAPTER_CLAUDE, ADAPTER_GEMINI],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      locked: false,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
      setAdapter,
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));
    await userEvent.click(screen.getByTestId('composer-adapter-select-option-claude'));

    expect(setAdapter).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. A model with isDefault=true shows "default" in its row text
// ---------------------------------------------------------------------------

describe('ProviderModelSelect — default model shows "default" marker', () => {
  it('renders "default" in the row text for SONNET (isDefault=true)', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    const sonnetRow = screen.getByTestId('composer-model-select-option-sonnet');
    expect(sonnetRow.textContent).toContain('default');
  });

  it('does NOT render "default" in the row text for HAIKU (isDefault=false)', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    const haikuRow = screen.getByTestId('composer-model-select-option-haiku');
    expect(haikuRow.textContent).not.toContain('default');
  });
});

// ---------------------------------------------------------------------------
// 8. disabled=true (mid-turn) makes the whole picker inert
// ---------------------------------------------------------------------------

describe('ProviderModelSelect — disabled prop makes the picker inert mid-turn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('disabled=true renders the trigger with the disabled attribute', () => {
    renderSelect({ disabled: true });

    expect(screen.getByTestId('composer-model-select')).toBeDisabled();
  });

  it('disabled=true blocks the popover from opening and never calls setModel', async () => {
    const setModel = vi.fn();
    renderSelect({ disabled: true, setModel });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    expect(screen.queryByTestId('composer-provider-model-popover')).not.toBeInTheDocument();
    expect(setModel).not.toHaveBeenCalled();
  });

  it('disabled=false (default) leaves the trigger enabled and the popover openable', async () => {
    renderSelect({});

    const trigger = screen.getByTestId('composer-model-select');
    expect(trigger).not.toBeDisabled();

    await userEvent.click(trigger);

    expect(screen.getByTestId('composer-provider-model-popover')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 9. Older models sit under their own label, after the current ones
// ---------------------------------------------------------------------------

const OPUS_41: AdapterModel = {
  id: 'claude-opus-4-1-20250805',
  label: 'Opus 4.1',
  isOlder: true,
};

const ADAPTER_CLAUDE_WITH_OLDER: AdapterInfo = {
  ...ADAPTER_CLAUDE,
  models: [SONNET, HAIKU, OPUS_41],
};

describe('ProviderModelSelect — older models group', () => {
  it('renders the "Older models" label when the catalog carries an isOlder model', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE_WITH_OLDER],
      adapter: ADAPTER_CLAUDE_WITH_OLDER,
      model: SONNET,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    expect(screen.getByTestId('composer-model-older-header').textContent).toContain('Older models');
    // Collapsed by default — rows appear only after expanding the section.
    expect(screen.queryByTestId('composer-model-select-option-claude-opus-4-1-20250805')).toBeNull();
    await userEvent.click(screen.getByTestId('composer-model-older-header'));
    expect(screen.getByTestId('composer-model-select-option-claude-opus-4-1-20250805')).toBeInTheDocument();
  });

  it('orders the older row after the header, and the current rows before it', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE_WITH_OLDER],
      adapter: ADAPTER_CLAUDE_WITH_OLDER,
      model: SONNET,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));
    await userEvent.click(screen.getByTestId('composer-model-older-header'));

    const header = screen.getByTestId('composer-model-older-header');
    const haiku = screen.getByTestId('composer-model-select-option-haiku');
    const opus = screen.getByTestId('composer-model-select-option-claude-opus-4-1-20250805');
    expect(haiku.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(header.compareDocumentPosition(opus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('omits the "Older models" label when no model is flagged', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    expect(screen.queryByTestId('composer-model-older-header')).toBeNull();
  });

  it('selecting an older model calls setModel with its exact id', async () => {
    const setModel = vi.fn();
    renderSelect({
      adapters: [ADAPTER_CLAUDE_WITH_OLDER],
      adapter: ADAPTER_CLAUDE_WITH_OLDER,
      model: SONNET,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
      setModel,
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));
    await userEvent.click(screen.getByTestId('composer-model-older-header'));
    await userEvent.click(screen.getByTestId('composer-model-select-option-claude-opus-4-1-20250805'));

    expect(setModel).toHaveBeenCalledWith('claude-opus-4-1-20250805');
  });
});

// ---------------------------------------------------------------------------
// 9. Models reached through a separate endpoint sit in their own labelled group
// ---------------------------------------------------------------------------

const PROXY_SOL: AdapterModel = {
  id: 'cliproxy/gpt-5.6-sol',
  label: 'gpt-5.6-sol',
  description: 'openai',
  group: 'CLIProxyAPI',
};

const PROXY_KIMI: AdapterModel = {
  id: 'cliproxy/kimi-k3',
  label: 'kimi-k3',
  description: 'moonshot',
  group: 'CLIProxyAPI',
};

const ADAPTER_CLAUDE_WITH_PROXY: AdapterInfo = {
  ...ADAPTER_CLAUDE,
  models: [SONNET, HAIKU, OPUS_41, PROXY_SOL, PROXY_KIMI],
};

describe('ProviderModelSelect — endpoint model group', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders one header per group, labelled with the group name', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE_WITH_PROXY],
      adapter: ADAPTER_CLAUDE_WITH_PROXY,
      model: SONNET,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    expect(screen.getByTestId('composer-model-group-header-cliproxyapi').textContent).toContain('CLIProxyAPI');
    // Collapsed by default — rows appear only after expanding the section.
    expect(screen.queryByTestId('composer-model-select-option-cliproxy/gpt-5.6-sol')).toBeNull();
    await userEvent.click(screen.getByTestId('composer-model-group-header-cliproxyapi'));
    expect(screen.getByTestId('composer-model-select-option-cliproxy/gpt-5.6-sol')).toBeInTheDocument();
    expect(screen.getByTestId('composer-model-select-option-cliproxy/kimi-k3')).toBeInTheDocument();
  });

  it('places the group after both the current and the older rows', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE_WITH_PROXY],
      adapter: ADAPTER_CLAUDE_WITH_PROXY,
      model: SONNET,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));
    await userEvent.click(screen.getByTestId('composer-model-older-header'));

    const opus = screen.getByTestId('composer-model-select-option-claude-opus-4-1-20250805');
    const groupHeader = screen.getByTestId('composer-model-group-header-cliproxyapi');
    expect(opus.compareDocumentPosition(groupHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps grouped models out of the "Older models" section', async () => {
    renderSelect({
      adapters: [{ ...ADAPTER_CLAUDE, models: [SONNET, PROXY_SOL] }],
      adapter: { ...ADAPTER_CLAUDE, models: [SONNET, PROXY_SOL] },
      model: SONNET,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    expect(screen.queryByTestId('composer-model-older-header')).toBeNull();
    expect(screen.getByTestId('composer-model-group-header-cliproxyapi')).toBeInTheDocument();
  });

  it('omits every group header when no model carries a group', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    expect(screen.queryByTestId('composer-model-group-header-cliproxyapi')).toBeNull();
  });

  it('selects a grouped model by its namespaced id', async () => {
    const setModel = vi.fn();
    renderSelect({
      adapters: [ADAPTER_CLAUDE_WITH_PROXY],
      adapter: ADAPTER_CLAUDE_WITH_PROXY,
      model: SONNET,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
      setModel,
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));
    await userEvent.click(screen.getByTestId('composer-model-group-header-cliproxyapi'));
    await userEvent.click(screen.getByTestId('composer-model-select-option-cliproxy/kimi-k3'));

    expect(setModel).toHaveBeenCalledExactlyOnceWith('cliproxy/kimi-k3');
  });

  it('still shows the stored endpoint model when the endpoint has gone away', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE],
      adapter: ADAPTER_CLAUDE,
      model: null,
      chat: makeChat({ adapterId: 'claude', model: 'cliproxy/gpt-5.6-sol' }),
    });

    expect(screen.getByTestId('composer-model-select').textContent).toContain('cliproxy/gpt-5.6-sol');

    await userEvent.click(screen.getByTestId('composer-model-select'));

    expect(screen.getByTestId('composer-model-select-option-cliproxy/gpt-5.6-sol')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-model-group-header-cliproxyapi')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 10. Per-model tuning flyout (replaces the standalone EffortPicker/FeaturesPopover)
// ---------------------------------------------------------------------------

/** A model that exposes both effort levels and tunable options. */
const TUNABLE: AdapterModel = {
  id: 'tunable',
  label: 'Tunable',
  defaultEffort: 'medium',
  supportedEfforts: ['low', 'medium', 'high'],
  supportsFast: true,
};

const ADAPTER_TUNABLE: AdapterInfo = {
  ...ADAPTER_CLAUDE,
  models: [TUNABLE, HAIKU],
};

/**
 * Opens the model menu, then a model row's flyout. HOVER, not click — clicking
 * a row chooses that model and closes the whole menu, which is the point of the
 * pattern.
 */
async function openFlyout(user: ReturnType<typeof userEvent.setup>, modelId: string) {
  await user.click(screen.getByTestId('composer-model-select'));
  await user.hover(screen.getByTestId(`composer-model-select-option-${modelId}`));
  return screen.findByTestId(`composer-model-${modelId}-tuning`);
}

describe('ProviderModelSelect — per-model tuning flyout', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gives a model with no effort levels and no options no flyout at all', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderSelect({
      adapters: [ADAPTER_TUNABLE],
      adapter: ADAPTER_TUNABLE,
      model: TUNABLE,
      chat: makeChat({ adapterId: 'claude', model: 'tunable' }),
    });

    await user.click(screen.getByTestId('composer-model-select'));
    await user.click(screen.getByTestId('composer-model-select-option-haiku'));

    expect(screen.queryByTestId('composer-model-haiku-tuning')).toBeNull();
  });

  it("lists the model's own effort levels and options", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderSelect({
      adapters: [ADAPTER_TUNABLE],
      adapter: ADAPTER_TUNABLE,
      model: TUNABLE,
      chat: makeChat({ adapterId: 'claude', model: 'tunable' }),
    });

    await openFlyout(user, 'tunable');

    expect(screen.getByTestId('composer-model-tunable-effort-low')).toBeInTheDocument();
    expect(screen.getByTestId('composer-model-tunable-effort-high')).toBeInTheDocument();
    // xhigh is not in supportedEfforts, so it must not appear.
    expect(screen.queryByTestId('composer-model-tunable-effort-xhigh')).toBeNull();
    expect(screen.getByTestId('composer-model-tunable-feature-fast')).toBeInTheDocument();
    // The model does not advertise supportsUltracode.
    expect(screen.queryByTestId('composer-model-tunable-feature-ultracode')).toBeNull();
  });

  it("checks the model's DEFAULT effort when the chat has set none", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderSelect({
      adapters: [ADAPTER_TUNABLE],
      adapter: ADAPTER_TUNABLE,
      model: TUNABLE,
      chat: makeChat({ adapterId: 'claude', model: 'tunable' }),
    });

    await openFlyout(user, 'tunable');

    expect(screen.getByTestId('composer-model-tunable-effort-medium')).toHaveAttribute('data-state', 'checked');
    expect(screen.getByTestId('composer-model-tunable-effort-low')).toHaveAttribute('data-state', 'unchecked');
  });

  it("checks the chat's effort over the model default", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderSelect({
      adapters: [ADAPTER_TUNABLE],
      adapter: ADAPTER_TUNABLE,
      model: TUNABLE,
      chat: { ...makeChat({ adapterId: 'claude', model: 'tunable' }), effort: 'high' },
    });

    await openFlyout(user, 'tunable');

    expect(screen.getByTestId('composer-model-tunable-effort-high')).toHaveAttribute('data-state', 'checked');
    expect(screen.getByTestId('composer-model-tunable-effort-medium')).toHaveAttribute('data-state', 'unchecked');
  });

  it('picking an effort writes it and leaves the menu open', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const setEffort = vi.fn();
    renderSelect({
      adapters: [ADAPTER_TUNABLE],
      adapter: ADAPTER_TUNABLE,
      model: TUNABLE,
      chat: makeChat({ adapterId: 'claude', model: 'tunable' }),
      setEffort,
    });

    await openFlyout(user, 'tunable');
    // fireEvent, not userEvent: moving the pointer off the SubTrigger closes the
    // flyout in jsdom, where Radix's grace-area rects are all zero.
    fireEvent.click(screen.getByTestId('composer-model-tunable-effort-high'));

    expect(setEffort).toHaveBeenCalledExactlyOnceWith('high');
    expect(screen.getByTestId('composer-provider-model-popover')).toBeInTheDocument();
  });

  it('toggling an option writes only that field, inverted', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const setFeature = vi.fn();
    renderSelect({
      adapters: [ADAPTER_TUNABLE],
      adapter: ADAPTER_TUNABLE,
      model: TUNABLE,
      chat: { ...makeChat({ adapterId: 'claude', model: 'tunable' }), fast: true },
      setFeature,
    });

    await openFlyout(user, 'tunable');
    expect(screen.getByTestId('composer-model-tunable-feature-fast')).toHaveAttribute('data-state', 'checked');

    fireEvent.click(screen.getByTestId('composer-model-tunable-feature-fast'));

    expect(setFeature).toHaveBeenCalledExactlyOnceWith('fast', false);
  });

  it('a non-active model previews its defaults; touching a control switches to it with that tuning', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const setEffort = vi.fn();
    const setModelTuning = vi.fn();
    renderSelect({
      adapters: [ADAPTER_TUNABLE],
      adapter: ADAPTER_TUNABLE,
      // haiku is selected, so the tunable row is NOT the active model
      model: HAIKU,
      chat: { ...makeChat({ adapterId: 'claude', model: 'haiku' }), effort: 'low' },
      setEffort,
      setModelTuning,
    });

    await openFlyout(user, 'tunable');

    // Its own default, not the chat's 'low'.
    expect(screen.getByTestId('composer-model-tunable-effort-medium')).toHaveAttribute('data-state', 'checked');

    // One compound write: switch model AND apply the effort — never the plain
    // active-model setter, which would tune the wrong model.
    fireEvent.click(screen.getByTestId('composer-model-tunable-effort-high'));
    expect(setModelTuning).toHaveBeenCalledExactlyOnceWith('tunable', { effort: 'high' });
    expect(setEffort).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('composer-model-tunable-feature-fast'));
    expect(setModelTuning).toHaveBeenCalledWith('tunable', { fast: true });
  });

  it('clicking a flyout row still selects that model', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const setModel = vi.fn();
    renderSelect({
      adapters: [ADAPTER_TUNABLE],
      adapter: ADAPTER_TUNABLE,
      model: HAIKU,
      chat: makeChat({ adapterId: 'claude', model: 'haiku' }),
      setModel,
    });

    await user.click(screen.getByTestId('composer-model-select'));
    await user.click(screen.getByTestId('composer-model-select-option-tunable'));

    expect(setModel).toHaveBeenCalledExactlyOnceWith('tunable');
  });
});

// ---------------------------------------------------------------------------
// 11. Trigger label carries the resolved effort
// ---------------------------------------------------------------------------

describe('ProviderModelSelect — trigger effort suffix', () => {
  const CASES: { name: string; model: AdapterModel; chat: Chat; expected: string }[] = [
    {
      name: "the chat's own effort",
      model: TUNABLE,
      chat: { ...makeChat({ adapterId: 'claude', model: 'tunable' }), effort: 'high' },
      expected: 'Tunable · High',
    },
    {
      name: "the model's default effort when the chat sets none",
      model: TUNABLE,
      chat: makeChat({ adapterId: 'claude', model: 'tunable' }),
      expected: 'Tunable · Medium',
    },
    {
      name: 'no suffix at all for a model with no effort axis',
      model: HAIKU,
      chat: makeChat({ adapterId: 'claude', model: 'haiku' }),
      expected: 'Claude Haiku 4',
    },
  ];

  it.each(CASES)('shows $name', ({ model, chat, expected }) => {
    renderSelect({ adapters: [ADAPTER_TUNABLE], adapter: ADAPTER_TUNABLE, model, chat });

    expect(screen.getByTestId('composer-model-select').textContent).toBe(expected);
  });
});
