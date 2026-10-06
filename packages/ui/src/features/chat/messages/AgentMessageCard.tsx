/**
 * AgentMessageCard — a user turn another agent wrote through the orchestration
 * MCP server (see `markers/agent-message.ts`). Rendered as a card, not the
 * user's own bubble, so the reader can tell who spoke: a `chat_send` /
 * `chat_launch` prompt, a delegated task prompt, or a batch of task results.
 *
 * Same shell as ReviewCommentCard: a bordered card, a muted header band naming
 * the sender, then the markdown body.
 */
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Bot, ListChecks } from 'lucide-react';
import type { ReactNode } from 'react';
import { markdownComponents } from '../parts/markdown-text';
import { urlTransform, remarkAppLinks } from '../parts/markdown-url-transform';
import type { AgentMessage, ParsedAgentText, TaskResultMarker } from '../markers/agent-message';

const REMARK_PLUGINS = [remarkGfm, remarkAppLinks, remarkBreaks];

const KIND_LABELS: Record<AgentMessage['kind'], string> = {
  send: 'Message from chat',
  launch: 'Started by chat',
  task: 'Task from chat',
};

function CardShell({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      // Own end alignment, as ReviewCommentCard: the kit end-aligns only
      // children carrying its data-slot marker.
      className="max-w-[75%] self-end overflow-hidden rounded-xl border border-border bg-card shadow-sm"
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

function Body({ text }: { text: string }) {
  return (
    <div className="aui-md px-3 py-2.5 text-sm break-words">
      <Markdown remarkPlugins={REMARK_PLUGINS} urlTransform={urlTransform} components={markdownComponents}>
        {text}
      </Markdown>
    </div>
  );
}

function TaskResultSection({ result }: { result: TaskResultMarker }) {
  return (
    <div data-testid={`chat-task-result-card-${result.taskId}`} className="border-b border-border last:border-b-0">
      <Header icon={<ListChecks className="size-3.5 shrink-0 text-muted-foreground" />}>
        Task result · {result.status.replace(/_/g, ' ')} · chat <span className="font-mono">{result.chatId}</span>
      </Header>
      {result.body && <Body text={result.body} />}
    </div>
  );
}

export function AgentMessageCard({ parsed, messageId }: { parsed: ParsedAgentText; messageId: string }) {
  if (parsed.type === 'task-results') {
    return (
      <CardShell testId={`chat-agent-message-card-${messageId}`}>
        {parsed.results.map((result) => (
          <TaskResultSection key={result.taskId} result={result} />
        ))}
      </CardShell>
    );
  }
  const { message } = parsed;
  return (
    <CardShell testId={`chat-agent-message-card-${messageId}`}>
      <Header icon={<Bot className="size-3.5 shrink-0 text-muted-foreground" />}>
        {KIND_LABELS[message.kind]} <span className="font-mono">{message.fromChatId}</span>
      </Header>
      <Body text={message.body} />
    </CardShell>
  );
}
