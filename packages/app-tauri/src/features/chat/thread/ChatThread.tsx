/**
 * ChatThread — thread shell wiring the native message dispatch.
 *
 * Role-based message components (UserMessage / AssistantMessage / SystemMessage)
 * render through MessagePrimitive.GroupedParts + the tool-card registry. The
 * full thread-shell restyle (viewport footer, scroll-to-bottom, action bar) and
 * the composer port are later leaves — the chrome here stays intentionally thin.
 */
import { ThreadPrimitive, ComposerPrimitive } from '@assistant-ui/react';
import { UserMessage } from '../messages/UserMessage';
import { AssistantMessage } from '../messages/AssistantMessage';
import { SystemMessage } from '../messages/SystemMessage';
// Side-effect: populates the tool-card registry (kept out of registry.ts to break the import cycle).
import '../tools/register-cards';

// ---- Composer -----------------------------------------------------------------

function Composer() {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '12px 16px',
        borderTop: '1px solid #1e293b',
        background: '#0f172a',
      }}
    >
      <ComposerPrimitive.Input
        data-testid="chat-composer-input"
        placeholder="Message the assistant…"
        style={{
          flex: 1,
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: 6,
          padding: '8px 12px',
          color: '#f1f5f9',
          fontSize: 14,
          resize: 'none',
          outline: 'none',
        }}
      />
      <ComposerPrimitive.Send
        data-testid="chat-composer-send"
        style={{
          padding: '8px 16px',
          background: '#2563eb',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        Send
      </ComposerPrimitive.Send>
    </div>
  );
}

// ---- Thread -------------------------------------------------------------------

export function ChatThread() {
  return (
    <ThreadPrimitive.Root
      data-testid="chat-thread"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#0f172a',
        color: '#f1f5f9',
        fontFamily: 'system-ui, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Messages scroll area */}
      <ThreadPrimitive.Viewport
        data-testid="chat-thread-viewport"
        style={{ flex: 1, overflowY: 'auto', padding: '16px' }}
      >
        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            AssistantMessage,
            SystemMessage,
          }}
        />
        <ThreadPrimitive.ScrollToBottom />
      </ThreadPrimitive.Viewport>

      {/* Running indicator */}
      <ThreadPrimitive.If running>
        <div
          data-testid="chat-thread-running"
          style={{
            padding: '4px 16px',
            fontSize: 12,
            color: '#94a3b8',
            background: '#0f172a',
          }}
        >
          Thinking…
        </div>
      </ThreadPrimitive.If>

      <Composer />
    </ThreadPrimitive.Root>
  );
}
