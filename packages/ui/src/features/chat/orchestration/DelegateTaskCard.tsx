'use client';

/**
 * DelegateTaskCard — the `mcp__mainframe__delegate_task` tool call: the child
 * chat it started, the task's live status, and a link to open the child.
 *
 * A `tools.by_name` entry on assistant-ui's tool engine (the `TOOL_REGISTRY`
 * dispatch under `MessagePrimitive.GroupedParts`), in the shared
 * `CollapsibleCardShell` chrome like every other card. The result text fixes
 * the task and child ids; the title and status then follow the child's row in
 * the session list, which the daemon re-announces on every task change, so the
 * card stays live after the call returns.
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { useAui } from '@assistant-ui/react';
import { ExternalLink, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { CollapsibleCardShell, ErrorBody, StatusDot, resolveResultText } from '../tools/shared';
import { parseDelegateResult } from './delegate-result';
import { TaskStatusLabel } from './TaskStatusLabel';
import { findSession, useSessionItems } from './use-session-items';

function argText(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function OpenChild({ taskId, onOpen }: { taskId: string; onOpen?: () => void }) {
  return (
    <Hint label="Open the task's chat">
      <Button
        data-testid={`chat-tool-delegate-task-open-${taskId}`}
        aria-label="Open the task's chat"
        variant="ghost"
        size="icon-xs"
        disabled={onOpen == null}
        onClick={onOpen}
        className="text-muted-foreground"
      >
        <ExternalLink />
      </Button>
    </Hint>
  );
}

export const DelegateTaskCard: ToolCallMessagePartComponent = ({ args, result, isError }) => {
  const aui = useAui();
  const items = useSessionItems();
  const { text } = resolveResultText(result);
  const parsed = result === undefined || isError ? null : parseDelegateResult(text);
  const child = parsed == null ? undefined : findSession(items, parsed.childChatId);
  const task = argText(args, 'task');
  const title = child?.title ?? parsed?.title ?? argText(args, 'title') ?? 'Task';
  const status = child?.custom.delegation?.status ?? parsed?.status;

  const trailing =
    status != null ? (
      <TaskStatusLabel status={status} waiting={child?.custom.hasPending} testId="chat-tool-delegate-task-status" />
    ) : (
      <StatusDot result={result} isError={isError} />
    );

  return (
    <CollapsibleCardShell
      testId="chat-tool-delegate-task-card"
      triggerId="chat-tool-delegate-task-trigger"
      result={result}
      isError={isError}
      defaultOpen={false}
      disableTrigger={task == null && !isError}
      icon={<ListChecks />}
      verb="Delegate"
      target={<span className="text-sm text-muted-foreground">{title}</span>}
      trailing={trailing}
      headerAccessory={
        parsed != null ? (
          <OpenChild
            taskId={parsed.taskId}
            onOpen={child == null ? undefined : () => aui.threads.switchToThread(child.id)}
          />
        ) : undefined
      }
    >
      {isError ? (
        <ErrorBody text={text} testId="chat-tool-delegate-task-error" />
      ) : task != null ? (
        <p
          data-testid="chat-tool-delegate-task-prompt"
          className="border-t border-border px-3 py-2 text-sm leading-normal wrap-break-word whitespace-pre-wrap text-foreground"
        >
          {task}
        </p>
      ) : null}
    </CollapsibleCardShell>
  );
};

DelegateTaskCard.displayName = 'DelegateTaskCard';
