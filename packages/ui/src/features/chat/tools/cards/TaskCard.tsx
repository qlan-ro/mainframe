'use client';

/**
 * TaskCard — tool card for the native 'Task' (subagent) tool.
 *
 * Default COLLAPSED. Header shows the bot tile, agent type, model, and a
 * description line (with tooltip for the full prompt). Trailing status dot
 * reflects running vs. error vs. done.
 *
 * Body (expanded): the subagent transcript rendered as a real readonly nested
 * thread using `part.messages` (native field). Tool cards inside the transcript
 * dispatch through our standard (boundary-wrapped) message components — no
 * import-cycle risk because we import the MESSAGE components, not registry.ts.
 *
 * Deliberately DROPS:
 *  - Desktop's <usage> regex parser (usage metrics not in the native part shape)
 *  - Desktop's renderToolCard recursion (replaced by ReadonlyThreadProvider)
 *  - `_task_group` / children synthetic encoding (the native projection handles this)
 */

import { useState, useCallback } from 'react';
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { ReadonlyThreadProvider, ThreadPrimitive } from '@assistant-ui/react';
import { Bot, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';
import { cn } from '@/lib/utils';
import { ErrorDot } from '../shared';
import { boundedMessageComponents } from '../../messages/bounded-messages';

// ── Header sub-components ─────────────────────────────────────────────────────

interface TaskHeaderProps {
  agentName: string;
  model: string | undefined;
  description: string;
  fullPrompt: string | undefined;
  isRunning: boolean;
  isError: boolean | undefined;
}

function TaskHeader({ agentName, model, description, fullPrompt, isRunning, isError }: TaskHeaderProps) {
  return (
    <div className="flex min-w-0 items-center gap-2 py-0.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-mf-selection" aria-hidden>
        <Bot size={14} className="text-primary" />
      </span>

      {/* Agent name */}
      <TruncatedWithTooltip
        text={agentName}
        data-testid="chat-task-agent"
        className="max-w-[180px] text-label font-semibold text-primary"
      />

      {/* Model (mono, muted) */}
      {model && <TruncatedWithTooltip text={model} className="font-mono text-caption text-mf-text-4" />}

      {/* Description / prompt */}
      {description && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              data-testid="chat-task-description"
              className="min-w-0 flex-1 truncate text-caption text-muted-foreground"
              tabIndex={0}
            >
              {description}
            </span>
          </TooltipTrigger>
          {fullPrompt && (
            <TooltipContent side="bottom" className="max-w-[480px] whitespace-pre-wrap">
              {fullPrompt}
            </TooltipContent>
          )}
        </Tooltip>
      )}

      <span className="flex-1" />

      {/* Running dot */}
      {isRunning && (
        <span aria-label="Subagent running" className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-mf-warning" />
      )}

      {/* Error dot */}
      <ErrorDot isError={isError} />

      {/* Chevron (managed by Collapsible) */}
      <ChevronDown
        size={14}
        className={cn(
          'shrink-0 text-muted-foreground transition-transform duration-200',
          'group-data-[state=open]/task-card:rotate-0',
          'group-data-[state=closed]/task-card:-rotate-90',
        )}
      />
    </div>
  );
}

// ── Subagent transcript ───────────────────────────────────────────────────────

function SubagentTranscript({ messages }: { messages: readonly import('@assistant-ui/react').ThreadMessage[] }) {
  return (
    <div className="ml-[12px] border-l-2 border-border pl-3.5">
      <ReadonlyThreadProvider messages={messages}>
        <ThreadPrimitive.Messages components={boundedMessageComponents} />
      </ReadonlyThreadProvider>
    </div>
  );
}

// ── TaskCard ──────────────────────────────────────────────────────────────────

export const TaskCard: ToolCallMessagePartComponent = (part) => {
  const { args, result, isError, status, messages } = part;

  const agentName = (args['subagent_type'] as string | undefined) ?? 'Task';
  const model = args['model'] as string | undefined;
  const rawDescription = (args['description'] as string | undefined) ?? (args['prompt'] as string | undefined) ?? '';

  // Trim description to single line for the header; show full in tooltip
  const description = rawDescription.length > 80 ? rawDescription.slice(0, 80) + '…' : rawDescription;
  const fullPrompt =
    rawDescription.length > 0
      ? rawDescription.length > 600
        ? rawDescription.slice(0, 600) + '…'
        : rawDescription
      : undefined;

  const isRunning = status?.type === 'running' || result === undefined;

  // Scroll lock: collapse animates so we track open state locally
  const [open, setOpen] = useState(false);
  const handleOpenChange = useCallback((next: boolean) => setOpen(next), []);

  return (
    <Collapsible
      data-testid="chat-task-card"
      data-state={open ? 'open' : 'closed'}
      className="group/task-card w-full rounded-lg border border-border bg-card px-[10px] py-[7px]"
      open={open}
      onOpenChange={handleOpenChange}
    >
      <CollapsibleTrigger
        data-testid="chat-task-toggle"
        className="w-full text-left hover:opacity-80 transition-opacity"
        aria-label={`Toggle ${agentName} transcript`}
      >
        <TaskHeader
          agentName={agentName}
          model={model}
          description={description}
          fullPrompt={fullPrompt}
          isRunning={isRunning}
          isError={isError}
        />
      </CollapsibleTrigger>

      <CollapsibleContent>
        {messages && messages.length > 0 ? (
          <div className="mt-2">
            <SubagentTranscript messages={messages} />
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
};

TaskCard.displayName = 'TaskCard';
