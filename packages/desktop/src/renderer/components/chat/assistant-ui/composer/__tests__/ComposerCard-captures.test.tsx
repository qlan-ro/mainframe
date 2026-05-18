import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Capture } from '../../../../../store/sandbox.js';
import { capturesToRows } from '../../../../../lib/format-captures.js';

// --- sandbox store mock ---
const mockRemoveCapture = vi.fn();
let mockCaptures: Capture[] = [];

vi.mock('../../../../../store/sandbox.js', () => ({
  useSandboxStore: (sel: (s: { captures: Capture[]; removeCapture: (id: string) => void }) => unknown) =>
    sel({ captures: mockCaptures, removeCapture: mockRemoveCapture }),
}));

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

const elementCapture: Capture = {
  id: 'cap-element-1',
  type: 'element',
  imageDataUrl: 'data:image/png;base64,QUJD',
  selector: 'div.card > h2',
};

const screenshotCapture: Capture = {
  id: 'cap-screenshot-1',
  type: 'screenshot',
  imageDataUrl: 'data:image/png;base64,WFla',
  annotation: 'the header',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCaptures = [];
});

describe('ComposerCard capture area', () => {
  it('renders SandboxCaptureContext with selector-crumb and annotation when captures are present', () => {
    mockCaptures = [elementCapture, screenshotCapture];
    render(<ComposerCard />);
    expect(screen.getByTestId('sandbox-capture-context')).toBeTruthy();
    expect(screen.getAllByTestId('selector-crumb').length).toBeGreaterThan(0);
    expect(screen.getByText('the header')).toBeTruthy();
    expect(screen.getAllByRole('img').length).toBe(2);
  });

  it('clicking capture-remove calls removeCapture with the correct capture id', () => {
    mockCaptures = [elementCapture, screenshotCapture];
    render(<ComposerCard />);

    const { idByLabel } = capturesToRows(mockCaptures);

    const removeBtns = screen.getAllByTestId('capture-remove');
    expect(removeBtns.length).toBe(2);

    fireEvent.click(removeBtns[0]!);
    expect(mockRemoveCapture).toHaveBeenCalledWith(idByLabel['element1']);

    fireEvent.click(removeBtns[1]!);
    expect(mockRemoveCapture).toHaveBeenCalledWith(idByLabel['screenshot1']);
  });

  it('does not render sandbox-capture-context when captures is empty', () => {
    mockCaptures = [];
    render(<ComposerCard />);
    expect(screen.queryByTestId('sandbox-capture-context')).toBeNull();
  });
});
