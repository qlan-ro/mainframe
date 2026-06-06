/**
 * AdapterSelect — behavior tests.
 *
 * Strategy:
 *  - Fully prop-driven component; no hooks or context dependencies beyond
 *    TooltipProvider (required by the Tooltip wrapper inside AdapterSelect).
 *  - All expected values are hardcoded; setAdapter expectations are exact strings,
 *    not recomputed from the input fixtures.
 *  - DropdownMenuContent uses a Radix Portal, so items appear on document.body.
 *    Use `screen.findByTestId` (async) after clicking the trigger to wait for
 *    the portal to mount.
 *
 * Behaviors covered:
 *  1. adapters=[]         → renders nothing (trigger absent).
 *  2. adapters=[one]      → renders nothing (<=1 rule).
 *  3. adapters=[two], locked=false
 *                         → trigger present, label is the current adapter's name,
 *                            trigger is NOT disabled.
 *  4. locked=true         → trigger has the disabled attribute.
 *  5. Click trigger → click gemini option → setAdapter called once with 'gemini'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { AdapterInfo, Chat } from '@qlan-ro/mainframe-types';
import { AdapterSelect } from '../AdapterSelect';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal AdapterInfo for the claude adapter. */
const ADAPTER_CLAUDE: AdapterInfo = {
  id: 'claude',
  name: 'Claude Code',
  description: 'Claude CLI adapter',
  installed: true,
  models: [],
  capabilities: { planMode: true },
};

/** Minimal AdapterInfo for the gemini adapter. */
const ADAPTER_GEMINI: AdapterInfo = {
  id: 'gemini',
  name: 'Gemini',
  description: 'Gemini CLI adapter',
  installed: true,
  models: [],
  capabilities: { planMode: false },
};

/** Minimal Chat with adapterId set to 'claude'. */
const CHAT_CLAUDE = { adapterId: 'claude' } as Chat;

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderSelect(props: Parameters<typeof AdapterSelect>[0]) {
  return render(
    <TooltipProvider>
      <AdapterSelect {...props} />
    </TooltipProvider>,
  );
}

// ---------------------------------------------------------------------------
// 1. adapters=[] → renders nothing
// ---------------------------------------------------------------------------

describe('AdapterSelect — adapters=[] renders nothing', () => {
  it('does not render the trigger when adapters is empty', () => {
    const { container } = renderSelect({
      chat: CHAT_CLAUDE,
      adapters: [],
      locked: false,
      setAdapter: vi.fn(),
    });

    expect(screen.queryByTestId('composer-adapter-select')).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. adapters=[single] → renders nothing (the <=1 rule)
// ---------------------------------------------------------------------------

describe('AdapterSelect — single adapter renders nothing', () => {
  it('does not render the trigger when there is only one adapter', () => {
    const { container } = renderSelect({
      chat: CHAT_CLAUDE,
      adapters: [ADAPTER_CLAUDE],
      locked: false,
      setAdapter: vi.fn(),
    });

    expect(screen.queryByTestId('composer-adapter-select')).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Two adapters, locked=false → trigger present with current adapter's name
// ---------------------------------------------------------------------------

describe('AdapterSelect — two adapters, locked=false', () => {
  it('renders the trigger button with testid composer-adapter-select', () => {
    renderSelect({
      chat: CHAT_CLAUDE,
      adapters: [ADAPTER_CLAUDE, ADAPTER_GEMINI],
      locked: false,
      setAdapter: vi.fn(),
    });

    expect(screen.getByTestId('composer-adapter-select')).toBeInTheDocument();
  });

  it("trigger label is the current adapter's name — 'Claude Code'", () => {
    renderSelect({
      chat: CHAT_CLAUDE,
      adapters: [ADAPTER_CLAUDE, ADAPTER_GEMINI],
      locked: false,
      setAdapter: vi.fn(),
    });

    expect(screen.getByTestId('composer-adapter-select')).toHaveTextContent('Claude Code');
  });

  it('trigger is NOT disabled when locked=false', () => {
    renderSelect({
      chat: CHAT_CLAUDE,
      adapters: [ADAPTER_CLAUDE, ADAPTER_GEMINI],
      locked: false,
      setAdapter: vi.fn(),
    });

    expect(screen.getByTestId('composer-adapter-select')).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 4. locked=true → trigger is disabled
// ---------------------------------------------------------------------------

describe('AdapterSelect — locked=true disables the trigger', () => {
  it('trigger has the disabled attribute when locked=true', () => {
    renderSelect({
      chat: CHAT_CLAUDE,
      adapters: [ADAPTER_CLAUDE, ADAPTER_GEMINI],
      locked: true,
      setAdapter: vi.fn(),
    });

    expect(screen.getByTestId('composer-adapter-select')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 5. Open menu and click an option → setAdapter called with correct id
// ---------------------------------------------------------------------------

describe('AdapterSelect — selecting an option calls setAdapter', () => {
  let setAdapter: ReturnType<typeof vi.fn<(adapterId: string) => void>>;

  beforeEach(() => {
    setAdapter = vi.fn<(adapterId: string) => void>();
  });

  it("clicking the gemini option calls setAdapter once with 'gemini'", async () => {
    const user = userEvent.setup();

    renderSelect({
      chat: CHAT_CLAUDE,
      adapters: [ADAPTER_CLAUDE, ADAPTER_GEMINI],
      locked: false,
      setAdapter,
    });

    // Open the dropdown via userEvent (fires the full pointer+click sequence
    // that Radix DropdownMenu requires to transition to the open state).
    await user.click(screen.getByTestId('composer-adapter-select'));

    // Items render into a Radix portal on document.body — wait for them.
    const geminiOption = await screen.findByTestId('composer-adapter-select-option-gemini');
    await user.click(geminiOption);

    expect(setAdapter).toHaveBeenCalledTimes(1);
    expect(setAdapter).toHaveBeenCalledWith('gemini');
  });
});
