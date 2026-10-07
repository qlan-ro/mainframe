/**
 * The expanded body of a `delegate_task` card: the task chat's live
 * transcript, read-only, through the same nested-transcript path a native
 * subagent uses (`SubagentTranscript` › `ReadonlyThreadProvider`), and its
 * pending gate, answered with the main thread's own gate cards into the
 * child's session.
 *
 * Bounded to the latest `TASK_CHAT_WINDOW` messages; when more exist, a
 * leading row counts them and opens the full chat. Lazy-loaded by the card,
 * which mounts it only while expanded — mounting is what attaches the
 * child's stream (`useTaskChat`).
 */
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GateCard } from '../gates/GateCard';
import { SubagentTranscript } from '../tools/cards/SubagentTranscript';
import { useTaskChat, type TaskChatView } from './use-task-chat';

export interface TaskChatTranscriptProps {
  chatId: string;
  taskId: string;
  /** The parent message and tool call this transcript nests under (disclosure keys). */
  messageId: string;
  toolCallId: string;
  /** Opens the child chat; absent while its list row has not loaded. */
  onOpen?: () => void;
}

function EarlierMessages({ count, taskId, onOpen }: { count: number; taskId: string; onOpen?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {count} earlier {count === 1 ? 'message' : 'messages'}
      </span>
      <Button
        data-testid={`chat-tool-delegate-task-open-full-${taskId}`}
        variant="ghost"
        size="xs"
        disabled={onOpen == null}
        onClick={onOpen}
        className="text-muted-foreground"
      >
        <ExternalLink />
        Open full chat
      </Button>
    </div>
  );
}

function emptyText(loadState: TaskChatView['loadState']): string {
  if (loadState.type === 'error') return "Couldn't load the task's chat.";
  if (loadState.type === 'ready') return 'No messages yet.';
  return "Loading the task's chat…";
}

export function TaskChatTranscript({ chatId, taskId, messageId, toolCallId, onOpen }: TaskChatTranscriptProps) {
  const view = useTaskChat(chatId);
  return (
    <div
      data-testid={`chat-tool-delegate-task-transcript-${taskId}`}
      className="flex flex-col gap-2 border-t border-border px-3 py-2"
    >
      {view.hiddenCount > 0 && <EarlierMessages count={view.hiddenCount} taskId={taskId} onOpen={onOpen} />}
      {view.messages.length > 0 ? (
        <SubagentTranscript messages={view.messages} messageId={messageId} toolCallId={toolCallId} />
      ) : (
        <p data-testid={`chat-tool-delegate-task-empty-${taskId}`} className="text-xs text-muted-foreground">
          {emptyText(view.loadState)}
        </p>
      )}
      {view.gate != null && (
        <div data-testid={`chat-tool-delegate-task-gate-${taskId}`}>
          <GateCard entry={view.gate} reply={view.reply} adapterId={view.adapterId} />
        </div>
      )}
    </div>
  );
}
