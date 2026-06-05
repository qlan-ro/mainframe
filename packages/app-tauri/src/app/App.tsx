/**
 * App — Phase 2A chat-seam prototype.
 *
 * Wiring:
 *  useConnectionState → daemon port → daemonWs.setPort / connect
 *  User enters a chatId → ChatRuntimeProvider mounts (per-chat controller created)
 *  ChatThread renders transcript + composer
 *
 * Loading state is owned by the controller's loadState; ChatThread exposes it
 * via the assistant-ui runtime (isLoading prop on useExternalStoreRuntime).
 * No second subscriber — the controller is the single source of truth.
 */
import { useState, useEffect } from 'react';
import { useConnectionState, type ConnectionState } from './useConnectionState';
import { daemonWs } from '../lib/daemon/ws-client';
import { ChatRuntimeProvider } from '../features/chat/runtime/ChatRuntimeProvider';
import { ChatThread } from '../features/chat/thread/ChatThread';

// ---- Connection dot -----------------------------------------------------------

const STATUS_COLOR: Record<ConnectionState, string> = {
  connecting: '#f59e0b',
  connected: '#22c55e',
  disconnected: '#ef4444',
};

// ---- Root app -----------------------------------------------------------------

export function App() {
  const { state, daemonStatus, port } = useConnectionState();
  const [chatId, setChatId] = useState('');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  // Wire the WS client to the port once available.
  useEffect(() => {
    if (port == null) return;
    daemonWs.setPort(port);
    daemonWs.connect();
    return () => {
      // Keep connection alive while App is mounted (singleton).
    };
  }, [port]);

  const handleOpenChat = () => {
    const id = chatId.trim();
    if (!id) return;
    setActiveChatId(id);
  };

  const handleSwitchChat = () => {
    // Clear active chat first — this disposes the old subscriber.
    setActiveChatId(null);
    setTimeout(() => {
      const id = chatId.trim();
      if (id) setActiveChatId(id);
    }, 0);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#0f172a',
        color: '#f1f5f9',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Drag region for macOS traffic lights */}
      <div data-tauri-drag-region style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 40, zIndex: 100 }} />

      {/* Status bar */}
      <div
        data-testid="app-status-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px 4px',
          marginTop: 40,
          fontSize: 12,
          color: '#64748b',
          flexShrink: 0,
        }}
      >
        <span
          data-testid="app-connection-dot"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: STATUS_COLOR[state],
            display: 'inline-block',
          }}
        />
        <span>
          {daemonStatus} {port != null ? `· port ${port}` : ''}
        </span>
      </div>

      {/* Chat ID input + controls */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '8px 16px',
          borderBottom: '1px solid #1e293b',
          flexShrink: 0,
        }}
      >
        <input
          data-testid="app-chatid-input"
          type="text"
          placeholder="Paste a chat ID…"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (activeChatId) handleSwitchChat();
              else handleOpenChat();
            }
          }}
          style={{
            flex: 1,
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 6,
            padding: '6px 10px',
            color: '#f1f5f9',
            fontSize: 13,
            outline: 'none',
          }}
        />
        <button
          data-testid="app-open-chat-btn"
          onClick={activeChatId ? handleSwitchChat : handleOpenChat}
          disabled={port == null || !chatId.trim()}
          style={{
            padding: '6px 14px',
            background: port == null ? '#334155' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: port == null ? 'not-allowed' : 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {activeChatId ? 'Switch' : 'Open'}
        </button>
        {activeChatId && (
          <button
            data-testid="app-close-chat-btn"
            onClick={() => setActiveChatId(null)}
            style={{
              padding: '6px 14px',
              background: '#334155',
              color: '#94a3b8',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Close
          </button>
        )}
      </div>

      {/* Chat area */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {!activeChatId && (
          <div
            data-testid="app-no-chat"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#475569',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 32 }}>No chat open</span>
            <span style={{ fontSize: 13 }}>Enter a chat ID above to open a transcript</span>
          </div>
        )}

        {activeChatId && port != null && (
          <ChatRuntimeProvider key={activeChatId} chatId={activeChatId} daemonPort={port}>
            <ChatThread />
          </ChatRuntimeProvider>
        )}

        {activeChatId && port == null && (
          <div data-testid="app-waiting-port" style={{ padding: 16, color: '#94a3b8' }}>
            Waiting for daemon…
          </div>
        )}
      </div>
    </div>
  );
}
