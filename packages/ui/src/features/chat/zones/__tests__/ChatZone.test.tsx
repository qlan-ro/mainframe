/**
 * ChatZone — side-chat host placement (todo #344, AC 16).
 *
 * Two zones are rendered side by side, mirroring ChatSurface's split branch.
 * Covers: `SideChatHost` mounts inside `chat-zone-<chatId>` keyed by THAT
 * zone's own chat id, and the other zone's DOM (its own thread + host) is
 * untouched by it — each zone gets its own, independent side-chat host.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('@assistant-ui/react', () => ({
  AuiProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  AuiConfig: (v: unknown) => v,
  ExternalThread: (v: unknown) => v,
  useAui: () => ({}),
}));
vi.mock('@assistant-ui/store', () => ({ Derived: (v: unknown) => v }));

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
const zoneControllers = new Map<string, unknown>();
vi.mock('../../../sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: {
    getOrCreate: (id: string) => {
      if (!zoneControllers.has(id)) {
        // A stable snapshot reference — useSyncExternalStore requires
        // getState() to return the SAME object across calls.
        const state = { runState: { type: 'idle' }, loadState: { type: 'idle' }, messages: [] };
        zoneControllers.set(id, {
          id,
          getState: () => state,
          subscribeState: () => () => undefined,
          subscribeLive: () => () => undefined,
          load: async () => undefined,
          sendMessage: vi.fn(),
          cancel: vi.fn(),
        });
      }
      return zoneControllers.get(id);
    },
  },
}));
vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  CHAT_ATTACHMENT_ADAPTER: {},
  useControllerState: (c: { getState: () => unknown }) => c.getState(),
}));
vi.mock('../../runtime/chat-extras', () => ({
  buildChatExtras: () => ({}),
  isRunningFromState: () => false,
  useChatExtrasState: (state: unknown) => state,
}));
vi.mock('../../runtime/use-native-thread-messages', () => ({ useNativeThreadMessages: () => [] }));
vi.mock('@/features/session-panel/SessionPanel', () => ({ SessionPanel: () => <div data-testid="session-panel" /> }));
vi.mock('@/features/session-panel/use-session-panel-state', () => ({
  useSessionPanelState: () => ({ hostRef: () => undefined, mode: 'hidden' }),
}));
vi.mock('../../thread/ChatThread', () => ({
  ChatThread: () => <div data-testid="chat-thread-stub" />,
}));
vi.mock('@/features/side-chat/SideChatHost', () => ({
  SideChatHost: ({ parentChatId, children }: { parentChatId: string | null; children: React.ReactNode }) => (
    <div data-testid={`side-chat-host-stub-${parentChatId}`}>{children}</div>
  ),
}));
// ZoneStrip reads the zone's rebound `threadListItem` through
// ChatHeaderParentLink/SideChatToggle — out of scope for this suite, which is
// about where SideChatHost mounts, not the strip's own content.
vi.mock('../ZoneStrip', () => ({
  ZoneStrip: ({ chatId }: { chatId: string }) => <div data-testid={`chat-zone-strip-${chatId}`} />,
}));

import { ChatZone } from '../ChatZone';

describe('ChatZone — side-chat host placement (todo #344)', () => {
  it("mounts SideChatHost inside its own zone, keyed by that zone's chat id", () => {
    render(
      <>
        <ChatZone chatId="chat-a" focused onFocus={() => {}} onClose={() => {}} />
        <ChatZone chatId="chat-b" focused={false} onFocus={() => {}} onClose={() => {}} />
      </>,
    );

    const zoneA = screen.getByTestId('chat-zone-chat-a');
    const zoneB = screen.getByTestId('chat-zone-chat-b');

    expect(within(zoneA).getByTestId('side-chat-host-stub-chat-a')).toBeInTheDocument();
    expect(within(zoneB).getByTestId('side-chat-host-stub-chat-b')).toBeInTheDocument();
  });

  it('leaves the other zone untouched — no cross-zone side-chat host leaks in', () => {
    render(
      <>
        <ChatZone chatId="chat-a" focused onFocus={() => {}} onClose={() => {}} />
        <ChatZone chatId="chat-b" focused={false} onFocus={() => {}} onClose={() => {}} />
      </>,
    );

    const zoneA = screen.getByTestId('chat-zone-chat-a');
    const zoneB = screen.getByTestId('chat-zone-chat-b');

    expect(within(zoneA).queryByTestId('side-chat-host-stub-chat-b')).toBeNull();
    expect(within(zoneB).queryByTestId('side-chat-host-stub-chat-a')).toBeNull();
    // Both zones still render their own thread — the host is additive, not a replacement.
    expect(within(zoneA).getByTestId('chat-thread-stub')).toBeInTheDocument();
    expect(within(zoneB).getByTestId('chat-thread-stub')).toBeInTheDocument();
  });
});
