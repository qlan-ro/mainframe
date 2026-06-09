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
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ProviderModelSelect } from '../ProviderModelSelect';
import type { AdapterInfo, AdapterModel, Chat } from '@qlan-ro/mainframe-types';

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
  setAdapter?: (id: string) => void;
  setModel?: (id: string) => void;
}

function renderSelect(props: RenderProps = {}) {
  const setAdapter = props.setAdapter ?? vi.fn();
  const setModel = props.setModel ?? vi.fn();
  const chat = props.chat ?? makeChat({ adapterId: 'claude', model: 'sonnet' });
  const adapters = props.adapters ?? [ADAPTER_CLAUDE];
  const adapter = props.adapter !== undefined ? props.adapter : ADAPTER_CLAUDE;
  const model = props.model !== undefined ? props.model : SONNET;
  const locked = props.locked ?? false;

  render(
    <TooltipProvider>
      <ProviderModelSelect
        chat={chat}
        adapters={adapters}
        adapter={adapter}
        model={model}
        locked={locked}
        setAdapter={setAdapter}
        setModel={setModel}
      />
    </TooltipProvider>,
  );

  return { setAdapter, setModel };
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

  it('locked=false does NOT render the provider footer', async () => {
    renderSelect({
      adapters: [ADAPTER_CLAUDE, ADAPTER_GEMINI],
      adapter: ADAPTER_CLAUDE,
      model: SONNET,
      locked: false,
      chat: makeChat({ adapterId: 'claude', model: 'sonnet' }),
    });

    await userEvent.click(screen.getByTestId('composer-model-select'));

    expect(screen.queryByTestId('composer-provider-footer')).not.toBeInTheDocument();
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
