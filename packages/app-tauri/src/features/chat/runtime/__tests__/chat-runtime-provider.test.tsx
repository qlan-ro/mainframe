/**
 * ChatRuntimeProvider — behavior tests (TDD red phase for Task 4.13).
 *
 * Verifies the refactored "single global runtime" shape:
 *  1. Renders children so the tree is functional.
 *  2. Passes the sentinel runtime from useSessionsThreadList to
 *     AssistantRuntimeProvider (the global runtime is wired correctly).
 *  3. useSessionsThreadList is called exactly once (one global runtime, not per-chat).
 *  4. The module still re-exports the three convenience hooks as functions
 *     (back-compat for existing importers).
 *  5. createControllerRegistry is NO LONGER exported (the old per-provider map
 *     is gone from the public API).
 *
 * Mock strategy:
 *  - useSessionsThreadList → spy returning a fixed sentinel symbol.
 *  - AssistantRuntimeProvider → spy that captures the `runtime` prop and
 *    renders children (so test 1 can pass and test 2 can verify the value).
 *  - DaemonPortProvider is NOT mocked — useSessionsThreadList is mocked so the
 *    real DaemonPortProvider just wraps the tree; no port read happens.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Hoist mocks
// ---------------------------------------------------------------------------

const SENTINEL_RUNTIME = Symbol('sentinel-sessions-runtime');

const capturedRuntimeProp: { current: unknown } = { current: undefined };
const useSessionsThreadListCallCount = { current: 0 };

vi.mock('../../sessions/runtime/use-sessions-thread-list', () => ({
  useSessionsThreadList: () => {
    useSessionsThreadListCallCount.current += 1;
    return SENTINEL_RUNTIME;
  },
}));

vi.mock('@assistant-ui/react', () => ({
  AssistantRuntimeProvider: ({ runtime, children }: { runtime: unknown; children: ReactNode }) => {
    capturedRuntimeProp.current = runtime;
    return <>{children}</>;
  },
  // Transitively used by use-chat-thread-runtime (re-exported from this module)
  useAuiState: vi.fn(() => undefined),
  useExternalStoreRuntime: vi.fn(() => ({})),
  // Used by projectChatThreadRepository (reached via the current RuntimeWiring path)
  ExportedMessageRepository: { fromArray: vi.fn(() => ({})) },
}));

// Mocked so the current ChatRuntimeProvider's RuntimeWiring path doesn't crash
// when it reaches useChatThreadRuntime → projectChatThreadRepository.
vi.mock('../../controller/project-messages', () => ({
  projectChatThreadRepository: vi.fn(() => ({})),
}));

vi.mock('../../composer/attachment-adapter', () => ({
  createAttachmentAdapter: vi.fn(() => ({})),
}));

vi.mock('../../gates/select-front', () => ({
  selectPermissionFront: vi.fn(() => undefined),
}));

vi.mock('../../sessions/runtime/new-thread-coordinator', () => ({
  createForLocal: vi.fn().mockResolvedValue({ remoteId: 'chat-x' }),
}));

vi.mock('../../../lib/daemon/ws-client', () => ({
  daemonWs: {},
}));

// ---------------------------------------------------------------------------
// Import subject AFTER mocks are in place
// ---------------------------------------------------------------------------

import { ChatRuntimeProvider as _ChatRuntimeProvider } from '../ChatRuntimeProvider';
import * as mod from '../ChatRuntimeProvider';

// Cast to the intended post-implementation signature.
// The current provider accepts { chatId, daemonPort } (per-chat); Task 4.13
// replaces it with { port } (global runtime). The test is intentionally failing
// until that implementation is complete.
const ChatRuntimeProvider = _ChatRuntimeProvider as unknown as (props: {
  port: number;
  children: ReactNode;
}) => React.ReactElement | null;

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  capturedRuntimeProp.current = undefined;
  useSessionsThreadListCallCount.current = 0;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Behavior 1: renders children
// ---------------------------------------------------------------------------

describe('ChatRuntimeProvider — renders children', () => {
  it('renders the child element when wrapped in ChatRuntimeProvider', () => {
    render(
      <ChatRuntimeProvider port={31415}>
        <div data-testid="sessions-child" />
      </ChatRuntimeProvider>,
    );

    expect(screen.getByTestId('sessions-child')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Behavior 2: AssistantRuntimeProvider receives the sentinel runtime
// ---------------------------------------------------------------------------

describe('ChatRuntimeProvider — wires the global sessions runtime', () => {
  it('passes the runtime from useSessionsThreadList to AssistantRuntimeProvider', () => {
    render(
      <ChatRuntimeProvider port={31415}>
        <div />
      </ChatRuntimeProvider>,
    );

    expect(capturedRuntimeProp.current).toBe(SENTINEL_RUNTIME);
  });
});

// ---------------------------------------------------------------------------
// Behavior 3: useSessionsThreadList called exactly once (one global runtime)
// ---------------------------------------------------------------------------

describe('ChatRuntimeProvider — mounts a single global runtime', () => {
  it('calls useSessionsThreadList exactly once on mount', () => {
    render(
      <ChatRuntimeProvider port={31415}>
        <div />
      </ChatRuntimeProvider>,
    );

    expect(useSessionsThreadListCallCount.current).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Behavior 4: convenience hooks are re-exported as functions
// ---------------------------------------------------------------------------

describe('ChatRuntimeProvider — re-exports back-compat convenience hooks', () => {
  it('exports useChatExtras as a function', () => {
    expect(typeof mod.useChatExtras).toBe('function');
  });

  it('exports useChatPermissionFront as a function', () => {
    expect(typeof mod.useChatPermissionFront).toBe('function');
  });

  it('exports useChatQueuedMessages as a function', () => {
    expect(typeof mod.useChatQueuedMessages).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Behavior 5: createControllerRegistry is NOT exported (old per-provider map gone)
// ---------------------------------------------------------------------------

describe('ChatRuntimeProvider — drops the old per-provider controller registry', () => {
  it('does NOT export createControllerRegistry', () => {
    expect('createControllerRegistry' in mod).toBe(false);
  });
});
