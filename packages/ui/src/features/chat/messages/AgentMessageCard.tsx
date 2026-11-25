/**
 * AgentMessageCard — a user turn another agent wrote through the orchestration
 * MCP server (see `markers/agent-message.ts`). Rendered as a card, not the
 * user's own bubble, so the reader can tell who spoke: a `chat_send` /
 * `chat_launch` prompt, a delegated task prompt, or
 * (`kind: 'dropped'`) a delivery notice for a queued `chat_send` the daemon's
 * permission-ceiling re-check refused — rendered as a clear "not delivered"
 * notice rather than attributed to a sender, since its `fromChatId` carries
 * the TARGET chat the send was headed to, not a speaker.
 *
 * A bordered card with a muted header band naming the sender (or the notice),
 * then the markdown body. Left-aligned and full width like assistant content,
 * not end-aligned like the user's bubble: the user didn't write it. Headers
 * name a chat by its title, falling back to the raw id only while the chat
 * isn't loaded or has no title. Task results are drawn in their task's own row
 * (T1f); one whose row isn't loaded is a line here.
 */
import { Bot, ListChecks, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useChatTitle } from '../orchestration/use-session-items';
import { MarkerPill } from '../tools/markers/MarkerPill';
import { Prose } from './turn/Prose';
import type { AgentMessage, ParsedAgentText, TaskResultMarker } from '../markers/agent-message';

const KIND_LABELS: Record<AgentMessage['kind'], string> = {
  send: 'Message from',
  launch: 'Started by',
  task: 'Task from',
  dropped: 'Message not delivered',
};

function CardShell({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      // No data-slot, so the user turn's end alignment skips it and the
      // column's stretch makes it full width.
      className="w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm"
    >
      {children}
    </div>
  );
}

function Header({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-border bg-muted px-3 py-1.5">
      {icon}
      <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{children}</span>
    </div>
  );
}

function ChatName({ chatId }: { chatId: string }) {
  const title = useChatTitle(chatId);
  if (title != null) return <span className="text-foreground">{title}</span>;
  return (
    <>
      chat <span className="font-mono">{chatId}</span>
    </>
  );
}

function Body({ text }: { text: string }) {
  return <Prose text={text} className="px-3 py-2.5 text-sm" />;
}

/**
 * A delegated task's result whose own card isn't in the loaded history (T1f):
 * one line on the spine, so the result is not lost.
 */
function TaskResultLine({ result }: { result: TaskResultMarker }) {
  const title = useChatTitle(result.chatId);
  const status = result.status === 'cancelled' ? 'stopped' : result.status.replace(/_/g, ' ');
  return (
    <MarkerPill
      rowKey={`task-result:${result.taskId}`}
      testId={`chat-task-result-${result.taskId}`}
      icon={ListChecks}
      label="Task result"
      target={title ?? result.chatId}
      mono={title === undefined}
      receipt={status}
      state={result.status === 'failed' ? 'failed' : 'done'}
    >
      {result.body && <Prose text={result.body} />}
    </MarkerPill>
  );
}

export function AgentMessageCard({ parsed, messageId }: { parsed: ParsedAgentText; messageId: string }) {
  if (parsed.type === 'task-results') {
    return (
      <div className="flex flex-col gap-1.5">
        {parsed.results.map((result) => (
          <TaskResultLine key={result.taskId} result={result} />
        ))}
      </div>
    );
  }
  const { message } = parsed;
  // `dropped` is a delivery notice, not an attributed turn: its `fromChatId`
  // is the target the send was headed to, not a speaker, so the header names
  // only the notice — the body (the daemon's note) already says which chat.
  if (message.kind === 'dropped') {
    return (
      <CardShell testId={`chat-agent-message-card-${messageId}`}>
        <Header icon={<TriangleAlert className="size-3.5 shrink-0 text-fail" />}>{KIND_LABELS.dropped}</Header>
        <Body text={message.body} />
      </CardShell>
    );
  }
  return (
    <CardShell testId={`chat-agent-message-card-${messageId}`}>
      <Header icon={<Bot className="size-3.5 shrink-0 text-muted-foreground" />}>
        {KIND_LABELS[message.kind]} <ChatName chatId={message.fromChatId} />
      </Header>
      <Body text={message.body} />
    </CardShell>
  );
}
