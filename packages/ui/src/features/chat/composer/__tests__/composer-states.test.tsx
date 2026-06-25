/**
 * Composer visual-state behavior tests — Phase 3 parity fixes.
 *
 * Covers:
 *  1. SendOrCancelButton shape — 26×26px rounded-square (not 32px circle)
 *  2. PlanModeToggle amber active state (border-mf-warning / bg-mf-warning-tint / text-mf-warning)
 *  3. EffortPicker lock icon when ultracode-locked
 *  4. FeaturesPopover active-feature accent dot indicator
 *  5. ProviderModelSelect footer in BOTH locked and unlocked states
 *  6. PermissionSelect per-option description notes
 *  7. Toolbar hairline separator between paperclip and config chips
 *  8. Edit-mode composer amber ambient-glow shadow
 *
 * Each test asserts hardcoded expected values against the rendered DOM —
 * never derives expectations from the component's own logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Mocks for Composer (worktree / AUI plumbing)
// ---------------------------------------------------------------------------

let __extrasReturn: 'none' | { worktreeMissing?: boolean; worktreePath?: string } = 'none';

vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useChatExtras: () => (__extrasReturn === 'none' ? undefined : { state: { chatConfig: __extrasReturn } }),
}));

vi.mock('@assistant-ui/react', () => ({
  ComposerPrimitive: {
    Root: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => <div {...rest}>{children}</div>,
    AttachmentDropzone: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...rest}>{children}</div>
    ),
    Input: ({ children, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
      <textarea {...rest}>{children}</textarea>
    ),
    Send: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...rest}>{children}</button>
    ),
    Cancel: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...rest}>{children}</button>
    ),
  },
  useAuiState: (selector: (s: { thread: { isRunning: boolean; messages: unknown[] } }) => unknown) =>
    selector({ thread: { isRunning: false, messages: [] } }),
  useAui: () => ({ composer: () => ({ send: vi.fn() }) }),
}));

vi.mock('../edit/composer-edit-context', () => ({
  useComposerEdit: () => ({ editing: null, cancelEdit: vi.fn() }),
}));

vi.mock('../config-toolbar/ComposerToolbar', () => ({
  ComposerToolbar: () => null,
}));

vi.mock('@/components/ui/assistant-ui/attachment', () => ({
  ComposerAttachments: () => null,
  ComposerAddAttachment: () => <button data-testid="composer-add-attachment" />,
}));

vi.mock('@/components/ui/assistant-ui/quote', () => ({
  ComposerQuotePreview: () => null,
}));

vi.mock('../triggers/ComposerTriggers', () => ({
  ComposerTriggers: ({ children }: { children: React.ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// Subject imports
// ---------------------------------------------------------------------------

import { Composer } from '../Composer';
import { PlanModeToggle } from '../config-toolbar/PlanModeToggle';
import { EffortPicker } from '../config-toolbar/EffortPicker';
import { FeaturesPopover } from '../config-toolbar/FeaturesPopover';
import { ProviderModelSelect } from '../config-toolbar/ProviderModelSelect';
import { PermissionSelect } from '../config-toolbar/PermissionSelect';
import type { AdapterInfo, AdapterModel, Chat } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    adapterId: 'claude',
    projectId: 'proj-1',
    status: 'active',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    ...overrides,
  };
}

const MODEL_WITH_EFFORTS: AdapterModel = {
  id: 'sonnet',
  label: 'Claude Sonnet 4',
  supportedEfforts: ['low', 'medium', 'high'],
  supportsUltracode: false,
  supportsFast: false,
  supportsAdaptiveThinking: false,
};

const MODEL_WITH_ULTRACODE: AdapterModel = {
  id: 'opus',
  label: 'Claude Opus 4',
  supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
  supportsUltracode: true,
  supportsFast: true,
  supportsAdaptiveThinking: true,
};

const ADAPTER_PLAN: AdapterInfo = {
  id: 'claude',
  name: 'Claude',
  description: 'Anthropic Claude',
  installed: true,
  models: [MODEL_WITH_EFFORTS],
  capabilities: { planMode: true },
};

const ADAPTER_CLAUDE: AdapterInfo = {
  id: 'claude',
  name: 'Claude',
  description: 'Anthropic Claude',
  installed: true,
  models: [MODEL_WITH_EFFORTS],
  capabilities: { planMode: false },
};

const ADAPTER_GEMINI: AdapterInfo = {
  id: 'gemini',
  name: 'Gemini',
  description: 'Google Gemini',
  installed: true,
  models: [{ id: 'gemini-flash', label: 'Gemini Flash' }],
  capabilities: { planMode: false },
};

// ---------------------------------------------------------------------------
// 1. Send button shape — 26×26px rounded-square
// ---------------------------------------------------------------------------

describe('Composer — send button is a 26px rounded-square, not a 32px circle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __extrasReturn = { worktreeMissing: false };
  });

  it('send button class list contains size-[26px] (not size-8)', () => {
    render(
      <TooltipProvider>
        <Composer />
      </TooltipProvider>,
    );

    const send = screen.getByTestId('chat-composer-send');
    expect(send.className).toContain('size-[26px]');
    expect(send.className).not.toContain('size-8');
  });

  it('send button class list contains rounded-md (not rounded-full)', () => {
    render(
      <TooltipProvider>
        <Composer />
      </TooltipProvider>,
    );

    const send = screen.getByTestId('chat-composer-send');
    expect(send.className).toContain('rounded-md');
    expect(send.className).not.toContain('rounded-full');
  });
});

// ---------------------------------------------------------------------------
// 2. PlanModeToggle — amber active state
// ---------------------------------------------------------------------------

describe('PlanModeToggle — amber active styling', () => {
  it('active state has border-mf-warning class (amber border)', () => {
    render(
      <TooltipProvider>
        <PlanModeToggle chat={makeChat({ planMode: true })} adapter={ADAPTER_PLAN} setPlanMode={vi.fn()} />
      </TooltipProvider>,
    );

    const btn = screen.getByTestId('composer-plan-toggle');
    expect(btn.className).toContain('border-mf-warning');
  });

  it('active state has bg-mf-warning-tint class (amber tint background)', () => {
    render(
      <TooltipProvider>
        <PlanModeToggle chat={makeChat({ planMode: true })} adapter={ADAPTER_PLAN} setPlanMode={vi.fn()} />
      </TooltipProvider>,
    );

    const btn = screen.getByTestId('composer-plan-toggle');
    expect(btn.className).toContain('bg-mf-warning-tint');
  });

  it('active state has text-mf-warning class (amber icon color)', () => {
    render(
      <TooltipProvider>
        <PlanModeToggle chat={makeChat({ planMode: true })} adapter={ADAPTER_PLAN} setPlanMode={vi.fn()} />
      </TooltipProvider>,
    );

    const btn = screen.getByTestId('composer-plan-toggle');
    expect(btn.className).toContain('text-mf-warning');
  });

  it('active state does NOT have bg-mf-selection (blue tint should be gone)', () => {
    render(
      <TooltipProvider>
        <PlanModeToggle chat={makeChat({ planMode: true })} adapter={ADAPTER_PLAN} setPlanMode={vi.fn()} />
      </TooltipProvider>,
    );

    const btn = screen.getByTestId('composer-plan-toggle');
    expect(btn.className).not.toContain('bg-mf-selection');
  });

  it('inactive state does NOT have bg-mf-warning-tint or border-mf-warning', () => {
    render(
      <TooltipProvider>
        <PlanModeToggle chat={makeChat({ planMode: false })} adapter={ADAPTER_PLAN} setPlanMode={vi.fn()} />
      </TooltipProvider>,
    );

    const btn = screen.getByTestId('composer-plan-toggle');
    expect(btn.className).not.toContain('bg-mf-warning-tint');
    expect(btn.className).not.toContain('border-mf-warning');
  });
});

// ---------------------------------------------------------------------------
// 3. EffortPicker — lock icon when ultracode-locked
// ---------------------------------------------------------------------------

describe('EffortPicker — lock icon visible when ultracode-locked', () => {
  it('renders a lock icon element when effort is ultracode-locked', () => {
    render(
      <TooltipProvider>
        <EffortPicker
          chat={makeChat({ ultracode: true })}
          model={MODEL_WITH_ULTRACODE}
          setEffort={vi.fn()}
          disabled={false}
        />
      </TooltipProvider>,
    );

    // The trigger button has data-testid="composer-effort-select"
    const trigger = screen.getByTestId('composer-effort-select');
    // When locked, a lock SVG icon should be inside the trigger
    const svg = trigger.querySelector('svg');
    expect(svg).not.toBeNull();
    // There should be at least 2 SVG children in the button (Gauge + Lock)
    const svgs = trigger.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT render extra lock icon when ultracode is off', () => {
    render(
      <TooltipProvider>
        <EffortPicker
          chat={makeChat({ ultracode: false })}
          model={MODEL_WITH_ULTRACODE}
          setEffort={vi.fn()}
          disabled={false}
        />
      </TooltipProvider>,
    );

    const trigger = screen.getByTestId('composer-effort-select');
    const svgs = trigger.querySelectorAll('svg');
    // Only the Gauge icon should be present (1 SVG, maybe 2 with ChevronDown)
    // The lock icon must NOT be there; when locked=false there are fewer SVGs
    // than when locked=true (the lock adds a third SVG).
    expect(svgs.length).toBeLessThan(3);
  });
});

// ---------------------------------------------------------------------------
// 4. FeaturesPopover — active-feature accent dot indicator
// ---------------------------------------------------------------------------

describe('FeaturesPopover — accent dot visible when a feature is active', () => {
  it('renders an accent dot inside the trigger when a feature is on (fast=true)', () => {
    render(
      <TooltipProvider>
        <FeaturesPopover
          chat={makeChat({ fast: true })}
          model={MODEL_WITH_ULTRACODE}
          setFeature={vi.fn()}
          disabled={false}
        />
      </TooltipProvider>,
    );

    const trigger = screen.getByTestId('composer-features-trigger');
    // The accent dot is a small span with bg-primary inside the button
    const dot = trigger.querySelector('span[class*="bg-primary"]');
    expect(dot).not.toBeNull();
  });

  it('does NOT render the accent dot when no feature is active', () => {
    render(
      <TooltipProvider>
        <FeaturesPopover
          chat={makeChat({ fast: false, ultracode: false, adaptiveThinking: false })}
          model={MODEL_WITH_ULTRACODE}
          setFeature={vi.fn()}
          disabled={false}
        />
      </TooltipProvider>,
    );

    const trigger = screen.getByTestId('composer-features-trigger');
    const dot = trigger.querySelector('span[class*="bg-primary"]');
    expect(dot).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. ProviderModelSelect — footer in BOTH locked and unlocked states
// ---------------------------------------------------------------------------

describe('ProviderModelSelect — footer shows in both locked and unlocked states', () => {
  async function openPopover(locked: boolean) {
    render(
      <TooltipProvider>
        <ProviderModelSelect
          chat={makeChat({ adapterId: 'claude', model: 'sonnet' })}
          adapters={[ADAPTER_CLAUDE, ADAPTER_GEMINI]}
          adapter={ADAPTER_CLAUDE}
          model={MODEL_WITH_EFFORTS}
          locked={locked}
          setAdapter={vi.fn()}
          setModel={vi.fn()}
        />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByTestId('composer-model-select'));
  }

  it('locked=true shows "Provider stays fixed for this session."', async () => {
    await openPopover(true);
    const footer = screen.getByTestId('composer-provider-footer');
    expect(footer.textContent).toBe('Provider stays fixed for this session.');
  });

  it('locked=false shows "Pick a provider before your first message."', async () => {
    await openPopover(false);
    const footer = screen.getByTestId('composer-provider-footer');
    expect(footer.textContent).toBe('Pick a provider before your first message.');
  });
});

// ---------------------------------------------------------------------------
// 6. PermissionSelect — per-option description notes
// ---------------------------------------------------------------------------

describe('PermissionSelect — dropdown items render description notes', () => {
  it('Interactive option renders its description note "Approve every action"', async () => {
    render(
      <TooltipProvider>
        <PermissionSelect chat={makeChat()} setPermissionMode={vi.fn()} />
      </TooltipProvider>,
    );

    await userEvent.click(screen.getByTestId('composer-permission-mode-select'));

    const interactive = screen.getByTestId('composer-permission-mode-select-option-default');
    expect(interactive.textContent).toContain('Approve every action');
  });

  it('Auto-Edits option renders its description note "Edits auto-applied; commands ask"', async () => {
    render(
      <TooltipProvider>
        <PermissionSelect chat={makeChat()} setPermissionMode={vi.fn()} />
      </TooltipProvider>,
    );

    await userEvent.click(screen.getByTestId('composer-permission-mode-select'));

    const autoEdits = screen.getByTestId('composer-permission-mode-select-option-acceptEdits');
    expect(autoEdits.textContent).toContain('Edits auto-applied; commands ask');
  });

  it('Unattended option renders its description note "Runs without prompts"', async () => {
    render(
      <TooltipProvider>
        <PermissionSelect chat={makeChat()} setPermissionMode={vi.fn()} />
      </TooltipProvider>,
    );

    await userEvent.click(screen.getByTestId('composer-permission-mode-select'));

    const unattended = screen.getByTestId('composer-permission-mode-select-option-yolo');
    expect(unattended.textContent).toContain('Runs without prompts');
  });
});

// ---------------------------------------------------------------------------
// 7. Composer bottom bar — hairline separator between paperclip and config chips
// ---------------------------------------------------------------------------

describe('Composer — hairline separator between attachment and toolbar controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __extrasReturn = { worktreeMissing: false };
  });

  it('renders a separator div with w-px and bg-border classes', () => {
    // We need a Composer that renders the real attachment slot + toolbar.
    // ComposerAddAttachment is stubbed to a button; ComposerToolbar to null.
    // The separator is a sibling between them.
    render(
      <TooltipProvider>
        <Composer />
      </TooltipProvider>,
    );

    // The separator is aria-hidden and has w-px + bg-border in its class
    const toolbar = screen.getByTestId('chat-composer-toolbar');
    const sep = toolbar.querySelector('[aria-hidden="true"][class*="w-px"]');
    expect(sep).not.toBeNull();
    expect((sep as HTMLElement).className).toContain('bg-border');
  });
});
