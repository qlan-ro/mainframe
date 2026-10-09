'use client';

/**
 * DelegateTaskCard — the `mcp__mainframe__delegate_task` tool call, and the
 * one place a task chat lives in the UI: task chats have no sidebar row.
 *
 * A `tools.by_name` entry on assistant-ui's tool engine (the `TOOL_REGISTRY`
 * dispatch under `MessagePrimitive.GroupedParts`), in the shared
 * `CollapsibleCardShell` chrome like every other card. The result text fixes
 * the task and child ids; the title and status then follow the child's row in
 * the session list, which the daemon re-announces on every task change.
 *
 * Expanding the card shows the child's live transcript and its pending gate
 * (`TaskChatTranscript`, lazy-loaded and mounted only while open — mounting
 * is what attaches the child's stream); until the call returns, the body is
 * the task prompt. A wait-mode call returns on the child's first gate, so
 * the transcript is there by the time a gate needs answering. The card is a
 * full card in compact mode too (`tool-kind.ts`). The card opens itself when the
 * child, or a task below it, starts waiting on the user; the user can still
 * collapse it, and the trailing status keeps reading "waiting" while it is.
 */
import { lazy, Suspense, useState } from 'react';
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { useAui } from '@assistant-ui/react';
import { ExternalLink, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { openInSplit } from '@/features/chat/zones/open-in-split';
import { CollapsibleCardShell, ErrorBody, StatusDot, resolveResultText } from '../tools/shared';
import { useCompactDetail } from '../tools/shared/compact-detail-context';
import { useTranscriptScope } from '../messages/compact/transcript-scope';
import { parseDelegateResult, type DelegateResult } from './delegate-result';
import { TaskStatusLabel } from './TaskStatusLabel';
import { findSession, useSessionItems } from './use-session-items';

const TaskChatTranscript = lazy(() =>
  import('./TaskChatTranscript').then((module) => ({ default: module.TaskChatTranscript })),
);

function argText(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function OpenChild({ taskId, archived, onOpen }: { taskId: string; archived: boolean; onOpen?: () => void }) {
  // aui's switchToThread unarchives an archived thread before opening it.
  const label = archived ? "Restore and open the task's chat beside this one" : "Open the task's chat beside this one";
  return (
    <Hint label={label}>
      <Button
        data-testid={`chat-tool-delegate-task-open-${taskId}`}
        aria-label={label}
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

/** Open while the user has it open, and opened again each time the child starts waiting on the user. */
function useAutoOpen(needsYou: boolean): [boolean, (open: boolean) => void] {
  const compactDetail = useCompactDetail();
  const [open, setOpen] = useState(compactDetail || needsYou);
  const [seen, setSeen] = useState(needsYou);
  if (seen !== needsYou) {
    setSeen(needsYou);
    if (needsYou) setOpen(true);
  }
  return [open, setOpen];
}

/**
 * The child's list row, whether it (or a task below it) waits on the user,
 * and how to open it: beside the parent (the chat this card lives in), via
 * the same `openInSplit` gesture the tab strip's ⌘-click and "Fork from
 * here" use, never a plain `switchToThread` that would replace the parent on
 * screen. `openInSplit` opens a fresh pair, or retargets the split's other
 * slot, with the parent's slot and visibility untouched either way; when the
 * child is already a member of the visible split it is a no-op, and the
 * `switchToThread` below only moves focus onto it (also unarchiving it, for
 * an archived child). A window too narrow for two zones parks the pair
 * exactly as fork leaves it — rendering, not this call, decides that.
 */
function useTaskChild(childChatId: string | undefined) {
  const aui = useAui();
  const items = useSessionItems();
  const child = childChatId == null ? undefined : findSession(items, childChatId);
  const needsYou = child != null && (child.custom.hasPending || child.custom.delegatedWaiting === true);
  const openChild =
    child == null
      ? undefined
      : () => {
          const { mainThreadId } = aui.threads.getState();
          openInSplit(mainThreadId, child.id);
          aui.threads.switchToThread(child.id);
        };
  return { child, needsYou, openChild };
}

interface CardBodyProps {
  /** Set for a refused call. */
  errorText?: string;
  parsed: DelegateResult | null;
  task: string | undefined;
  messageId: string;
  toolCallId: string;
  onOpen?: () => void;
}

/** The refusal, the child's chat once the call returned, or the task prompt until then. */
function CardBody({ errorText, parsed, task, messageId, toolCallId, onOpen }: CardBodyProps) {
  if (errorText != null) return <ErrorBody text={errorText} testId="chat-tool-delegate-task-error" />;
  if (parsed != null) {
    // The child's first message is the task prompt, so the transcript carries it.
    return (
      <Suspense fallback={null}>
        <TaskChatTranscript
          chatId={parsed.childChatId}
          taskId={parsed.taskId}
          messageId={messageId}
          toolCallId={toolCallId}
          onOpen={onOpen}
        />
      </Suspense>
    );
  }
  return (
    <p
      data-testid="chat-tool-delegate-task-prompt"
      className="border-t border-border px-3 py-2 text-sm leading-normal wrap-break-word whitespace-pre-wrap text-foreground"
    >
      {task}
    </p>
  );
}

export const DelegateTaskCard: ToolCallMessagePartComponent = ({ args, result, isError, toolCallId }) => {
  const { messageId = '' } = useTranscriptScope();
  const { text } = resolveResultText(result);
  const parsed = result === undefined || isError ? null : parseDelegateResult(text);
  const { child, needsYou, openChild } = useTaskChild(parsed?.childChatId);
  const task = argText(args, 'task');
  const title = child?.title ?? parsed?.title ?? argText(args, 'title') ?? 'Task';
  const status = child?.custom.delegation?.status ?? parsed?.status;
  const [open, setOpen] = useAutoOpen(needsYou);

  return (
    <CollapsibleCardShell
      testId="chat-tool-delegate-task-card"
      triggerId="chat-tool-delegate-task-trigger"
      result={result}
      isError={isError}
      open={open}
      onOpenChange={setOpen}
      disableTrigger={task == null && parsed == null && !isError}
      icon={<ListChecks />}
      verb="Delegate"
      target={<span className="text-sm text-muted-foreground">{title}</span>}
      trailing={
        status != null ? (
          <TaskStatusLabel status={status} waiting={needsYou} testId="chat-tool-delegate-task-status" />
        ) : (
          <StatusDot result={result} isError={isError} />
        )
      }
      headerAccessory={
        parsed != null ? (
          <OpenChild taskId={parsed.taskId} archived={child?.status === 'archived'} onOpen={openChild} />
        ) : undefined
      }
    >
      {isError || parsed != null || task != null ? (
        <CardBody
          errorText={isError ? text : undefined}
          parsed={parsed}
          task={task}
          messageId={messageId}
          toolCallId={toolCallId}
          onOpen={openChild}
        />
      ) : null}
    </CollapsibleCardShell>
  );
};

DelegateTaskCard.displayName = 'DelegateTaskCard';
