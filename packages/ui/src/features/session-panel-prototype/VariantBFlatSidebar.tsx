/**
 * THROWAWAY PROTOTYPE — Variant B, "Flat sidebar".
 *
 * A bordered aside flush against the surface edge, on the surface's own
 * background: no cards, no gaps. Sections are dense header rows (chevron,
 * sidebar-group-label typography, trailing count) divided by hairlines — the
 * classic inspector. Its rail is a flush strip, not a floating stack.
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
  changesTotals,
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

/** The inspector's one row rhythm — every body row sits on it. */
const ROW = 'flex h-7 items-center gap-2 px-2';

function Rail({ state }: { state: SessionPanelState }) {
  const { mode, focusRequest } = state;
  return (
    <div
      data-testid="proto-panel-rail"
      className="flex h-full w-9 shrink-0 flex-col items-center gap-0.5 border-l border-border bg-background py-1.5"
    >
      {SECTION_ORDER.map((id) => {
        const Icon = SECTION_ICON[id];
        const active = mode === 'overlay' && focusRequest?.id === id;
        return (
          <Hint key={id} label={SECTION_LABEL[id]} side="left">
            <Button
              data-testid={`proto-panel-rail-${id}`}
              variant="ghost"
              size="icon-xs"
              aria-pressed={active}
              onClick={() => state.selectSection(id)}
              className={cn('relative text-muted-foreground', active && 'bg-muted text-foreground')}
            >
              <Icon />
              {id === 'activity' && hasRunningActivity && (
                <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary" />
              )}
            </Button>
          </Hint>
        );
      })}

      <Separator className="my-1 w-4" />

      <Hint label="Run launch configuration" side="left">
        <Button data-testid="proto-panel-rail-launch" variant="ghost" size="icon-xs" className="text-muted-foreground">
          <Play />
        </Button>
      </Hint>
      <Hint label="Choose launch configuration" side="left">
        <Button
          data-testid="proto-panel-rail-launch-config"
          variant="ghost"
          size="icon-xs"
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
          size="icon-xs"
          onClick={state.toggleCollapsed}
          className="text-muted-foreground"
        >
          {mode === 'inline' ? <PanelRightClose /> : <PanelRightOpen />}
        </Button>
      </Hint>
    </div>
  );
}

function Section({
  id,
  state,
  trailing,
  children,
}: {
  id: SectionId;
  state: SessionPanelState;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const open = state.isSectionOpen(id);
  const count = SECTION_COUNT[id];
  return (
    <Collapsible open={open} onOpenChange={() => state.toggleSection(id)} asChild>
      <section
        ref={state.registerSection(id)}
        data-testid={`proto-panel-section-${id}`}
        className="shrink-0 border-b border-border last:border-b-0"
      >
        <div className="flex h-8 items-center gap-1 pr-1.5">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              data-testid={`proto-panel-section-toggle-${id}`}
              className="flex h-8 min-w-0 flex-1 items-center gap-1 px-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
              <span className="truncate">{SECTION_LABEL[id]}</span>
              {count != null && <Badge variant="secondary">{count}</Badge>}
            </button>
          </CollapsibleTrigger>
          {trailing}
        </div>
        <CollapsibleContent>
          <div className="flex flex-col pb-2">{children}</div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function SubHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex h-7 items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground">
      <span className="truncate">{label}</span>
      <Badge variant="secondary">{count}</Badge>
    </div>
  );
}

function SessionRows() {
  return (
    <>
      <div className={ROW}>
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm">{sessionStub.branch}</span>
        <Badge variant="secondary">{sessionStub.worktreeBadge}</Badge>
      </div>
      <div className={ROW}>
        <span className="shrink-0 text-xs text-muted-foreground">Context</span>
        <Progress value={sessionStub.contextPercent} className="h-1 min-w-0 flex-1 bg-muted" />
        <span className="shrink-0 font-mono text-xs tabular-nums">{sessionStub.contextPercent}%</span>
      </div>
      <div className={ROW}>
        <GitPullRequest className="size-3.5 shrink-0 text-success" />
        <span data-testid="proto-panel-pr" className="min-w-0 flex-1 truncate text-sm">
          PR #{sessionStub.prNumber}
        </span>
        <Badge variant="secondary">{sessionStub.prState}</Badge>
      </div>
    </>
  );
}

function ActivityRows() {
  return (
    <>
      {activityStub.map((task) => (
        <div key={task.id} data-testid={`proto-panel-task-${task.id}`} className={ROW}>
          {task.state === 'running' ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" />
          ) : (
            <CircleCheck className="size-3.5 shrink-0 text-success" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
          <span className="shrink-0 truncate text-xs text-muted-foreground">{task.detail}</span>
        </div>
      ))}
    </>
  );
}

function ChangesRows() {
  return (
    <>
      {changesStub.map((file) => (
        <div key={file.id} data-testid={`proto-panel-file-${file.id}`} className={ROW}>
          <span className={cn('w-3 shrink-0 font-mono text-xs font-semibold', STATUS_INK[file.status])}>
            {file.status}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
          <span className="shrink-0 font-mono text-xs text-success">+{file.added}</span>
          <span className="shrink-0 font-mono text-xs text-destructive">−{file.removed}</span>
        </div>
      ))}
      <div className="flex h-7 items-center justify-end gap-2 px-2 font-mono text-xs text-muted-foreground">
        <span>+{changesTotals.added}</span>
        <span>−{changesTotals.removed}</span>
      </div>
    </>
  );
}

function ContextRows() {
  return (
    <>
      {contextGroupsStub.map((group) => (
        <div key={group.id} className="flex flex-col">
          <SubHeading label={group.label} count={group.items.length} />
          {group.items.map((item) => (
            <div key={item.id} data-testid={`proto-panel-context-${group.id}-${item.id}`} className={cn(ROW, 'pl-4')}>
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
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border pr-1.5 pl-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">Session</span>
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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Section id="session" state={state}>
          <SessionRows />
        </Section>
        <Section id="activity" state={state}>
          <ActivityRows />
        </Section>
        <Section
          id="changes"
          state={state}
          trailing={
            <Button data-testid="proto-panel-review" variant="outline" size="xs">
              Review
              <Badge variant="secondary" data-icon="inline-end">
                {changesFindingsCount}
              </Badge>
            </Button>
          }
        >
          <ChangesRows />
        </Section>
        <Section id="context" state={state}>
          <ContextRows />
        </Section>
      </div>
    </>
  );
}

export function VariantBFlatSidebar({ state }: { state: SessionPanelState }) {
  const { mode } = state;
  return (
    <aside ref={state.rootRef} data-testid="proto-panel-root" data-proto-variant="B" className="relative flex h-full">
      {mode === 'inline' && (
        <div
          data-testid="proto-panel"
          className="flex h-full w-80 min-w-0 flex-col border-l border-border bg-background"
        >
          <PanelInner state={state} />
        </div>
      )}
      {mode === 'overlay' && (
        <div
          data-testid="proto-panel-overlay"
          className="absolute top-0 right-full z-30 flex h-full w-80 flex-col overflow-hidden border-x border-b border-border bg-background shadow-lg"
        >
          <PanelInner state={state} />
        </div>
      )}
      <Rail state={state} />
    </aside>
  );
}
