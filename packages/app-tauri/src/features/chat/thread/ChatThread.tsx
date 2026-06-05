/**
 * ChatThread — Phase 1 minimal thread renderer.
 *
 * Uses assistant-ui primitives directly (no shadcn yet — that is a Phase 2 task).
 * Text parts render as plain text. Tool-call parts render a fallback stub.
 * Permission sentinel (\0__MF_PERMISSION__) renders null.
 *
 * Phase 2: replace with proper shadcn-backed MessagePrimitive + tool-card registry.
 */
import { ThreadPrimitive, MessagePrimitive, ComposerPrimitive, useAuiState } from '@assistant-ui/react';
import { PERMISSION_PLACEHOLDER } from '../view-model/convert-message';

// ---- Text part ----------------------------------------------------------------

function TextPart() {
  return <MessagePrimitive.Content />;
}

// ---- Role label ---------------------------------------------------------------

function RoleLabel({ role }: { role: string }) {
  const labels: Record<string, string> = {
    user: 'You',
    assistant: 'Assistant',
    system: 'System',
  };
  return (
    <span style={{ fontWeight: 600, fontSize: 12, color: '#888', textTransform: 'uppercase' }}>
      {labels[role] ?? role}
    </span>
  );
}

// ---- Single message -----------------------------------------------------------

function Message() {
  const message = useAuiState((s) => s.message);
  const role = message.role;

  // Filter permission sentinel before rendering
  const visibleContent = message.content.filter(
    (part) => !(part.type === 'text' && part.text === PERMISSION_PLACEHOLDER.text),
  );
  if (visibleContent.length === 0) return null;

  const isUser = role === 'user';

  return (
    <div
      data-testid={`chat-message-${message.id}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        padding: '8px 0',
      }}
    >
      <RoleLabel role={role} />
      <div
        style={{
          marginTop: 4,
          maxWidth: '80%',
          padding: '8px 12px',
          borderRadius: 8,
          background: isUser ? '#2563eb' : '#1e293b',
          color: '#f1f5f9',
          fontSize: 14,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
        }}
      >
        <MessagePrimitive.Content
          components={{
            Text: ({ text }) => <span>{text}</span>,
            tools: {
              Fallback: ({ toolName, args }) => (
                <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>
                  [{toolName}({JSON.stringify(args).slice(0, 80)})]
                </span>
              ),
            },
          }}
        />
      </div>
    </div>
  );
}

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
            Message,
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

// Satisfy the unused `TextPart` lint rule — it is scaffolding for Phase 2.
void TextPart;
