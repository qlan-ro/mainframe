/**
 * A delegated task's chat inside its row: its live steps, read-only, and its
 * pending request, answered into the child's own session.
 *
 * Bounded to the latest `TASK_CHAT_WINDOW` messages; when more exist, a line
 * counts them and opens the full chat. Lazy-loaded and mounted only while the
 * row is open: mounting is what attaches the child's stream (`useTaskChat`).
 */
import { PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GateCard } from '../gates/GateCard';
import { AgentSteps, type AgentStepsProps } from '../messages/turn/AgentSteps';
import { BodyNote } from '../tools/bodies/Surface';
import { useTaskChat, type TaskChatView } from './use-task-chat';

export interface TaskChatStepsProps extends Omit<AgentStepsProps, 'messages' | 'before' | 'after'> {
  chatId: string;
  taskId: string;
  /** Opens the child chat; absent while its list row has not loaded. */
  onOpen?: () => void;
}

function EarlierMessages({ count, taskId, onOpen }: { count: number; taskId: string; onOpen?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="mf-tr-meta min-w-0 flex-1 truncate text-muted-foreground">
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
        <PanelRight />
        Open full chat
      </Button>
    </div>
  );
}

function emptyText(loadState: TaskChatView['loadState']): string | undefined {
  if (loadState.type === 'error') return "Couldn't load the task's chat.";
  return loadState.type === 'ready' ? undefined : "Loading the task's chat…";
}

export function TaskChatSteps({ chatId, taskId, onOpen, ...steps }: TaskChatStepsProps) {
  const view = useTaskChat(chatId);
  const empty = view.messages.length === 0 ? emptyText(view.loadState) : undefined;
  return (
    <div data-testid={`chat-tool-delegate-task-transcript-${taskId}`} className="min-w-0">
      <AgentSteps
        {...steps}
        messages={view.messages}
        before={
          view.hiddenCount > 0 ? (
            <EarlierMessages count={view.hiddenCount} taskId={taskId} onOpen={onOpen} />
          ) : (
            empty && <BodyNote testId={`chat-tool-delegate-task-empty-${taskId}`}>{empty}</BodyNote>
          )
        }
        after={
          view.gate != null && (
            <div data-testid={`chat-tool-delegate-task-gate-${taskId}`} className="py-1">
              <GateCard entry={view.gate} reply={view.reply} adapterId={view.adapterId} />
            </div>
          )
        }
      />
    </div>
  );
}
