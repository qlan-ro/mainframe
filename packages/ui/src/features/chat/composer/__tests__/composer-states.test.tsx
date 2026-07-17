/**
 * Composer visual-state behavior tests — Phase 3 parity fixes.
 *
 * Covers:
 *  1. Toolbar left slot — dedicated "@" mention button beside the paperclip
 *  2. ProviderModelSelect footer in BOTH locked and unlocked states
 *  3. PermissionSelect per-option description notes
 *  4. Toolbar hairline separator between paperclip and config chips
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
  useAuiState: (
    selector: (s: { thread: { isRunning: boolean; messages: unknown[] }; composer: { quote: undefined } }) => unknown,
  ) => selector({ thread: { isRunning: false, messages: [] }, composer: { quote: undefined } }),
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
  ComposerAddMention: () => <button data-testid="composer-add-mention" />,
}));

vi.mock('@/components/ui/assistant-ui/quote', () => ({
  ComposerQuotePreview: () => null,
}));

vi.mock('../triggers/ComposerTriggers', () => ({
  ComposerTriggers: ({ children }: { children: React.ReactNode }) => children,
}));

// ComposerHighlight reads useAuiState(s => s.composer.text) — a selector shape
// this file's useAuiState fake (thread-only) doesn't provide. Stub it out, same
// as Composer.test.tsx, since these tests assert on send/toolbar/plan/etc., not
// the highlight overlay's own rendering (covered by ComposerHighlight.test.tsx).
vi.mock('../highlight/ComposerHighlight', () => ({
  ComposerHighlight: () => null,
}));

// ---------------------------------------------------------------------------
// Subject imports
// ---------------------------------------------------------------------------

import { Composer } from '../Composer';
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
// 1b. Toolbar left slot — dedicated "@" mention button beside the paperclip
// ---------------------------------------------------------------------------

describe('Composer — toolbar renders a dedicated "@" mention button beside the paperclip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __extrasReturn = { worktreeMissing: false };
  });

  it('renders composer-add-mention inside the toolbar left slot', () => {
    render(
      <TooltipProvider>
        <Composer />
      </TooltipProvider>,
    );

    const toolbar = screen.getByTestId('chat-composer-toolbar');
    expect(toolbar.querySelector('[data-testid="composer-add-mention"]')).not.toBeNull();
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
