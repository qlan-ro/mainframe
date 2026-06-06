/**
 * App — Phase 2A chat-seam harness (warm-chrome).
 *
 * Wiring:
 *  useConnectionState → daemon port → daemonWs.setPort / connect
 *  User enters a chatId → ChatRuntimeProvider mounts (per-chat controller created)
 *  ChatThread renders transcript + composer
 *
 * The chat-id input bar is a dev harness; the real shell (sidebar / titlebar /
 * sessions list) is a later migration leaf.
 */
import { useState, useEffect } from 'react';
import { useConnectionState, type ConnectionState } from './useConnectionState';
import { cn } from '@/lib/utils';
import { daemonWs } from '../lib/daemon/ws-client';
import { ChatRuntimeProvider } from '../features/chat/runtime/ChatRuntimeProvider';
import { ChatThread } from '../features/chat/thread/ChatThread';
import { Toaster } from '@/components/ui/sonner';

const STATUS_DOT: Record<ConnectionState, string> = {
  connecting: 'bg-mf-warning',
  connected: 'bg-mf-success',
  disconnected: 'bg-destructive',
};

export function App() {
  const { state, daemonStatus, port } = useConnectionState();
  const [chatId, setChatId] = useState('');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  // Wire the WS client to the port once available.
  useEffect(() => {
    if (port == null) return;
    daemonWs.setPort(port);
    daemonWs.connect();
  }, [port]);

  const openChat = () => {
    const id = chatId.trim();
    if (id) setActiveChatId(id);
  };
  const switchChat = () => {
    setActiveChatId(null);
    setTimeout(() => {
      const id = chatId.trim();
      if (id) setActiveChatId(id);
    }, 0);
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground font-sans">
      {/* Drag region for macOS traffic lights */}
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-[100] h-10" />

      {/* Status bar */}
      <div
        data-testid="app-status-bar"
        className="mt-10 flex shrink-0 items-center gap-2 px-4 pb-1 pt-3 text-caption text-muted-foreground"
      >
        <span data-testid="app-connection-dot" className={cn('inline-block size-2 rounded-full', STATUS_DOT[state])} />
        <span>
          {daemonStatus}
          {port != null ? ` · port ${port}` : ''}
        </span>
      </div>

      {/* Chat ID input + controls (dev harness) */}
      <div className="flex shrink-0 gap-2 border-b border-border px-4 py-2">
        <input
          data-testid="app-chatid-input"
          type="text"
          placeholder="Paste a chat ID…"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (activeChatId ? switchChat : openChat)();
          }}
          className="flex-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-body text-foreground outline-none placeholder:text-mf-text-4 focus-visible:ring-1 focus-visible:ring-ring"
        />
        <button
          data-testid="app-open-chat-btn"
          onClick={activeChatId ? switchChat : openChat}
          disabled={port == null || !chatId.trim()}
          className="rounded-md bg-primary px-3.5 py-1.5 text-body font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {activeChatId ? 'Switch' : 'Open'}
        </button>
        {activeChatId && (
          <button
            data-testid="app-close-chat-btn"
            onClick={() => setActiveChatId(null)}
            className="rounded-md border border-border bg-card px-3.5 py-1.5 text-body text-muted-foreground transition-colors hover:text-foreground"
          >
            Close
          </button>
        )}
      </div>

      {/* Chat area */}
      <div className="relative flex-1 overflow-hidden">
        {!activeChatId && (
          <div
            data-testid="app-no-chat"
            className="flex h-full flex-col items-center justify-center gap-2 text-mf-text-4"
          >
            <span className="text-2xl">No chat open</span>
            <span className="text-body">Enter a chat ID above to open a transcript</span>
          </div>
        )}

        {activeChatId && port != null && (
          <ChatRuntimeProvider port={port}>
            <ChatThread />
          </ChatRuntimeProvider>
        )}

        {activeChatId && port == null && (
          <div data-testid="app-waiting-port" className="p-4 text-body text-muted-foreground">
            Waiting for daemon…
          </div>
        )}
      </div>

      <Toaster />
    </div>
  );
}
