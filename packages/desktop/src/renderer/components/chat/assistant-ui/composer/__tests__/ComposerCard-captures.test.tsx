import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useSandboxStore } from '../../../../../store/sandbox.js';

// --- MainframeRuntimeProvider mock ---
vi.mock('../../MainframeRuntimeProvider.js', () => ({
  useMainframeRuntime: () => ({
    chatId: 'chat-1',
    composerError: null,
    dismissComposerError: vi.fn(),
    openLightbox: vi.fn(),
    sendPendingCaptures: vi.fn(),
  }),
}));

// --- chats store mock ---
const { chatsStoreHook } = vi.hoisted(() => {
  const state = { chats: [] as unknown[], messages: new Map<string, unknown[]>(), activeChatId: null as string | null };
  const hook = Object.assign((sel: (s: typeof state) => unknown) => sel(state), {
    getState: () => state,
    subscribe: () => () => {},
  });
  return { chatsStoreHook: hook };
});
vi.mock('../../../../../store/chats.js', () => ({
  useChatsStore: chatsStoreHook,
}));

// --- adapters store mock ---
vi.mock('../../../../../store/adapters.js', () => ({
  useAdaptersStore: (sel: (s: { adapters: unknown[] }) => unknown) => sel({ adapters: [] }),
}));

// --- skills store mock ---
vi.mock('../../../../../store/skills.js', () => {
  const state = {
    pendingInvocation: null as null | string,
    skills: [] as unknown[],
    agents: [] as unknown[],
    commands: [] as unknown[],
  };
  const hook = (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state);
  hook.getState = () => state;
  hook.subscribe = () => () => {};
  return { useSkillsStore: hook };
});

// --- lib mocks ---
vi.mock('../../../../../lib/adapters.js', () => ({
  getAdapterOptions: () => [],
  getModelOptions: () => [],
  getModelLabel: () => '',
}));

vi.mock('../../../../../lib/client.js', () => ({
  daemonClient: { updateChatConfig: vi.fn() },
}));

vi.mock('../../../../../lib/api.js', () => ({
  getGitBranch: vi.fn(() => Promise.resolve({ branch: null })),
}));

vi.mock('../../../../../lib/focus.js', () => ({
  focusComposerInput: vi.fn(),
}));

vi.mock('../../../../../lib/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../composer-drafts.js', () => ({
  getDraft: () => null,
  saveDraft: vi.fn(),
  deleteDraft: vi.fn(),
}));

// --- @assistant-ui/react mock ---
vi.mock('@assistant-ui/react', async () => {
  const React = await import('react');
  const fakeRuntime = {
    getState: () => ({ text: '', isEmpty: true, attachments: [] }),
    subscribe: () => () => {},
    send: vi.fn(),
    setText: vi.fn(),
    addAttachment: vi.fn(),
  };
  return {
    ComposerPrimitive: {
      Root: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) =>
        React.createElement('div', props, children),
      Input: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => React.createElement('textarea', props),
      AddAttachment: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) =>
        React.createElement('button', props, children),
      Attachments: () => null,
      Cancel: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) =>
        React.createElement('button', props, children),
    },
    useComposerRuntime: () => fakeRuntime,
    useThread: () => ({ isRunning: false }),
    useSyncExternalStore: (subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  };
});

// --- sub-component mocks ---
vi.mock('../ComposerDropdown.js', () => ({
  ComposerDropdown: () => null,
}));

vi.mock('../EffortPicker.js', () => ({
  EffortPicker: () => null,
}));

vi.mock('../ComposerHighlight.js', () => ({
  ComposerHighlight: () => null,
}));

vi.mock('../ImageAttachmentPreview.js', () => ({
  ImageAttachmentPreview: () => null,
}));

vi.mock('../WorktreePopover.js', () => ({
  WorktreePopover: () => null,
}));

vi.mock('../QueuedMessageBanner.js', () => ({
  QueuedMessageBanner: () => null,
}));

vi.mock('../PlanModeToggle.js', () => ({
  PlanModeToggle: () => null,
}));

vi.mock('../../ContextPickerMenu.js', () => ({
  ContextPickerMenu: () => null,
}));

vi.mock('../../../ui/tooltip.js', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) =>
    React.createElement(React.Fragment, null, children),
  TooltipContent: () => null,
}));

import { ComposerCard } from '../ComposerCard.js';

describe('ComposerCard sandbox captures', () => {
  beforeEach(() => {
    useSandboxStore.getState().clearCaptures();
  });

  it('renders captures as thumbs with name captions in composer-attachments', () => {
    useSandboxStore.getState().addCapture({
      type: 'screenshot',
      imageDataUrl: 'data:image/png;base64,AAA',
    });
    useSandboxStore.getState().addCapture({
      type: 'element',
      imageDataUrl: 'data:image/png;base64,BBB',
      selector: 'main > button',
    });
    render(<ComposerCard />);
    const row = screen.getByTestId('composer-attachments');
    const thumbs = row.querySelectorAll('[data-testid="capture-thumb"]');
    expect(thumbs).toHaveLength(2);
    const names = Array.from(row.querySelectorAll('[data-testid="capture-thumb-name"]')).map((n) => n.textContent);
    expect(names).toEqual(['screenshot1', 'element1']);
  });

  it('renders SandboxCaptureContext (metadata sidecar) only for rows with selector/annotation', () => {
    useSandboxStore.getState().addCapture({
      type: 'screenshot',
      imageDataUrl: 'data:image/png;base64,AAA',
    });
    useSandboxStore.getState().addCapture({
      type: 'element',
      imageDataUrl: 'data:image/png;base64,BBB',
      selector: 'main > button.go',
    });
    render(<ComposerCard />);
    const meta = screen.getByTestId('sandbox-capture-context');
    const rows = meta.querySelectorAll('[data-testid="capture-meta-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('element1');
    expect(rows[0]!.querySelectorAll('[data-testid="selector-crumb"]').length).toBe(2);
  });

  it('× on a capture thumb removes that capture from the sandbox store', () => {
    useSandboxStore.getState().addCapture({
      type: 'screenshot',
      imageDataUrl: 'data:image/png;base64,AAA',
    });
    useSandboxStore.getState().addCapture({
      type: 'screenshot',
      imageDataUrl: 'data:image/png;base64,BBB',
    });
    render(<ComposerCard />);
    const removes = screen.getAllByTestId('capture-thumb-remove');
    fireEvent.click(removes[0]!);
    expect(useSandboxStore.getState().captures).toHaveLength(1);
    expect(useSandboxStore.getState().captures[0]!.imageDataUrl).toBe('data:image/png;base64,BBB');
  });
});
