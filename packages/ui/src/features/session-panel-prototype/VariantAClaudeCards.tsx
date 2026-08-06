/**
 * THROWAWAY PROTOTYPE — Variant A, "Claude cards".
 *
 * The rail is a borderless floating icon stack (no container chrome at all) and
 * the panel is a `bg-muted` gutter holding one `rounded-lg` card per section,
 * separated by gaps — Claude desktop's Progress / Outputs / Context column.
 * Nothing here is shared with variants B and C on purpose.
 */
import { Activity, GitBranch, GitCompare, GitPullRequest, Info, Layers } from 'lucide-react';
import { ChevronRight, CircleCheck, LoaderCircle, PanelRightClose, PanelRightOpen, Play, Rocket } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { Badge } from '@v2/components/ui/badge';
import { Button } from '@v2/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@v2/components/ui/collapsible';
import { Hint } from '@v2/components/ui/hint';
import { Progress } from '@v2/components/ui/progress';
import { Separator } from '@v2/components/ui/separator';
import { cn } from '@v2/lib/utils';
import {
  SECTION_COUNT,
  SECTION_LABEL,
  SECTION_ORDER,
  STATUS_INK,
  activityStub,
  changesFindingsCount,
  changesStub,
  contextGroupsStub,
  hasRunningActivity,
  sessionStub,
  type SectionId,
} from './stub-data';
import type { SessionPanelState } from './use-panel-state';

const SECTION_ICON: Record<SectionId, ComponentType<{ className?: string }>> = {
  session: Info,
  activity: Activity,
  changes: GitCompare,
  context: Layers,
};

function Rail({ state }: { state: SessionPanelState }) {
  const { mode, focusRequest } = state;
  return (
    <div data-testid="proto-panel-rail" className="flex h-full w-11 shrink-0 flex-col items-center gap-0.5 py-2">
      {SECTION_ORDER.map((id) => {
        const Icon = SECTION_ICON[id];
        const active = mode === 'overlay' && focusRequest?.id === id;
        return (
          <Hint key={id} label={SECTION_LABEL[id]} side="left">
            <Button
              data-testid={`proto-panel-rail-${id}`}
              variant="ghost"
              size="icon-sm"
              aria-pressed={active}
              onClick={() => state.selectSection(id)}
              className={cn('relative text-muted-foreground', active && 'bg-sidebar-selection text-primary')}
            >
              <Icon />
              {id === 'activity' && hasRunningActivity && (
                <LoaderCircle className="absolute top-1 right-1 size-2.5 animate-spin text-primary" />
              )}
            </Button>
          </Hint>
        );
      })}

      <Separator className="my-1.5 w-5" />

      <Hint label="Run launch configuration" side="left">
        <Button data-testid="proto-panel-rail-launch" variant="ghost" size="icon-sm" className="text-muted-foreground">
          <Play />
        </Button>
      </Hint>
      <Hint label="Choose launch configuration" side="left">
        <Button
          data-testid="proto-panel-rail-launch-config"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
        >
          <Rocket />
        </Button>
      </Hint>

      <span className="flex-1" />

      <Hint label={mode === 'inline' ? 'Collapse panel' : 'Expand panel'} side="left">
        <Button
          data-testid="proto-panel-rail-toggle"
          variant="ghost"
          size="icon-sm"
          onClick={state.toggleCollapsed}
          className="text-muted-foreground"
        >
          {mode === 'inline' ? <PanelRightClose /> : <PanelRightOpen />}
        </Button>
      </Hint>
    </div>
  );
}

function SectionCard({
  id,
  state,
  action,
  children,
}: {
  id: SectionId;
  state: SessionPanelState;
  action?: ReactNode;
  children: ReactNode;
}) {
  const open = state.isSectionOpen(id);
  const count = SECTION_COUNT[id];
  return (
    <Collapsible open={open} onOpenChange={() => state.toggleSection(id)} asChild>
      <section
        ref={state.registerSection(id)}
        data-testid={`proto-panel-section-${id}`}
        className="shrink-0 rounded-lg border border-border bg-card"
      >
        <div className="flex h-9 items-center gap-1 pr-1.5 pl-1.5">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              data-testid={`proto-panel-section-toggle-${id}`}
              className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 text-left transition-colors hover:bg-muted"
            >
              <ChevronRight
                className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
              />
              <span className="truncate text-sm font-semibold">{SECTION_LABEL[id]}</span>
              {count != null && <Badge variant="secondary">{count}</Badge>}
            </button>
          </CollapsibleTrigger>
          {action}
        </div>
        <CollapsibleContent>
          <div className="flex flex-col gap-2.5 px-3 pt-0.5 pb-3">{children}</div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function SessionCardBody() {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{sessionStub.branch}</span>
        <Badge variant="secondary">{sessionStub.worktreeBadge}</Badge>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Context used</span>
          <span className="font-mono text-xs font-semibold tabular-nums">{sessionStub.contextPercent}%</span>
        </div>
        <Progress value={sessionStub.contextPercent} className="h-1.5 bg-muted" />
        <span className="font-mono text-xs text-muted-foreground">{sessionStub.contextDetail}</span>
      </div>
      <div>
        <Badge variant="secondary" data-testid="proto-panel-pr">
          <GitPullRequest data-icon="inline-start" className="text-success" />
          PR #{sessionStub.prNumber} · {sessionStub.prState}
        </Badge>
      </div>
    </>
  );
}

function ActivityCardBody() {
  return (
    <>
      {activityStub.map((task) => (
        <div key={task.id} data-testid={`proto-panel-task-${task.id}`} className="flex items-start gap-2">
          {task.state === 'running' ? (
            <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />
          ) : (
            <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{task.title}</div>
            <div className="truncate text-xs text-muted-foreground">{task.detail}</div>
          </div>
        </div>
      ))}
    </>
  );
}

function ChangesCardBody() {
  return (
    <>
      {changesStub.map((file) => (
        <div key={file.id} data-testid={`proto-panel-file-${file.id}`} className="flex items-center gap-2">
          <span className={cn('w-3 shrink-0 font-mono text-xs font-semibold', STATUS_INK[file.status])}>
            {file.status}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
          <span className="shrink-0 font-mono text-xs text-success">+{file.added}</span>
          <span className="shrink-0 font-mono text-xs text-destructive">−{file.removed}</span>
        </div>
      ))}
    </>
  );
}

function ContextCardBody() {
  return (
    <>
      {contextGroupsStub.map((group) => (
        <div key={group.id} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{group.label}</span>
            <Badge variant="secondary">{group.items.length}</Badge>
          </div>
          {group.items.map((item) => (
            <div
              key={item.id}
              data-testid={`proto-panel-context-${group.id}-${item.id}`}
              className="flex items-center gap-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.detail}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function PanelInner({ state }: { state: SessionPanelState }) {
  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-1.5 pr-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">Session panel</span>
        <Hint label="Collapse panel">
          <Button
            data-testid="proto-panel-collapse"
            variant="ghost"
            size="icon-xs"
            onClick={state.toggleCollapsed}
            className="text-muted-foreground"
          >
            <PanelRightClose />
          </Button>
        </Hint>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        <SectionCard id="session" state={state}>
          <SessionCardBody />
        </SectionCard>
        <SectionCard id="activity" state={state}>
          <ActivityCardBody />
        </SectionCard>
        <SectionCard
          id="changes"
          state={state}
          action={
            <Button data-testid="proto-panel-review" variant="ghost" size="xs" className="text-muted-foreground">
              Review
              <Badge variant="secondary" data-icon="inline-end">
                {changesFindingsCount}
              </Badge>
            </Button>
          }
        >
          <ChangesCardBody />
        </SectionCard>
        <SectionCard id="context" state={state}>
          <ContextCardBody />
        </SectionCard>
      </div>
    </>
  );
}

export function VariantAClaudeCards({ state }: { state: SessionPanelState }) {
  const { mode } = state;
  return (
    <div ref={state.rootRef} data-testid="proto-panel-root" data-proto-variant="A" className="relative flex h-full">
      {mode === 'inline' && (
        <div data-testid="proto-panel" className="flex h-full w-80 min-w-0 flex-col bg-muted">
          <PanelInner state={state} />
        </div>
      )}
      {mode === 'overlay' && (
        <div
          data-testid="proto-panel-overlay"
          className="absolute top-2 right-full z-30 mr-1 flex max-h-[calc(100%-1rem)] w-80 flex-col overflow-hidden rounded-xl border border-border bg-muted shadow-lg"
        >
          <PanelInner state={state} />
        </div>
      )}
      <Rail state={state} />
    </div>
  );
}
