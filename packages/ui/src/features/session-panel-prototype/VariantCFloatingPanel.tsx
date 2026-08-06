/**
 * THROWAWAY PROTOTYPE — Variant C, "Floating panel".
 *
 * The Codex shape: nothing is ever flush. Even inline the panel is a detached
 * `rounded-xl` card inset from the surface edges with its own shadow and its own
 * internal scroll, and the rail is a slim floating pill rather than a strip.
 *
 * Panel anatomy after the 2026-08-06 refinement passes: no title bar, a
 * non-collapsible Summary at the top (branch, context row, PR, and a compact
 * Changes row carrying only the diff totals), then a near-verbatim copy of
 * assistant-ui's `agent-plan` element, then Background Activity and Context as
 * collapsible sections with the chevron on the trailing edge. Visibility is
 * purely width-driven — this variant has no collapse control — and the rail is
 * down to three buttons: open panel, context usage, run.
 */
import { Activity, Check, ChevronDown, GitBranch, GitCompare, GitPullRequest } from 'lucide-react';
import { Gauge, Image, Info, Layers, LoaderCircle, Play } from 'lucide-react';
import { useCallback, useState, type ComponentType, type ReactNode } from 'react';
import { Attachment, AttachmentMedia } from '@v2/components/ui/attachment';
import { Badge } from '@v2/components/ui/badge';
import { Button } from '@v2/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@v2/components/ui/collapsible';
import { Hint } from '@v2/components/ui/hint';
import { Separator } from '@v2/components/ui/separator';
import { QuotaRing } from '@v2/features/quota/QuotaRing';
import { cn } from '@v2/lib/utils';
import { severityOf } from '@/features/quota/quota-format';
import { extTint, fileExtMeta } from '@/features/chat/messages/file-ext-colors';
import {
  SECTION_LABEL,
  attachmentsStub,
  backgroundActivityStub,
  changesTotals,
  isImageAttachment,
  memoryFilesStub,
  planActiveIndex,
  planStepsStub,
  sessionStub,
  skillsStub,
  type AttachmentStub,
  type ContextGroupStub,
  type SectionId,
} from './stub-data';
import type { SessionPanelState } from './use-panel-state';

/**
 * C's Context sub-groups are its own: the memory files rather than A and B's
 * arbitrary open files, no Agents group, and an Attachments grid the others
 * don't show. Composed here from the shared item lists so A and B keep rendering
 * `contextGroupsStub` unchanged.
 */
const CONTEXT_GROUPS: readonly ContextGroupStub[] = [
  { id: 'files', label: 'Context', items: memoryFilesStub },
  { id: 'skills', label: 'Skills', items: skillsStub },
];
const CONTEXT_COUNT = CONTEXT_GROUPS.reduce((total, group) => total + group.items.length, 0) + attachmentsStub.length;

/**
 * The rail's one panel affordance targets `session` — the Summary, and the top
 * of the scroller — so opening and "scroll to top" are the same gesture. The id
 * is reused rather than renamed because the shared state machine keys scroll
 * targets and open-state by `SectionId`, and variants A and B still use it.
 */
const PANEL_TARGET: SectionId = 'session';

const STUB_LAUNCH_CONFIG = 'Dev server';

/**
 * Background Activity is in-progress work only, so the running count IS the item
 * count — it drives the section badge, the rail's live dot and its tooltip from
 * one place.
 */
const RUNNING_COUNT = backgroundActivityStub.length;
const RUNNING_LABEL = `${RUNNING_COUNT} task${RUNNING_COUNT === 1 ? '' : 's'} running`;

const PANEL_CHROME = 'flex w-80 flex-col overflow-hidden rounded-xl border border-border bg-card';

/** The header rhythm both the static Summary heading and the collapsible ones sit on. */
const SECTION_HEAD = 'flex h-10 items-center gap-2 px-3';

function Rail({ state }: { state: SessionPanelState }) {
  const { mode, focusRequest } = state;
  const percent = sessionStub.contextPercent;
  /** A rail button reads as engaged only while the panel it opened is floating. */
  const isTargeting = (id: SectionId) => mode === 'overlay' && focusRequest?.id === id;

  return (
    <div
      data-testid="proto-panel-rail"
      className="mt-2 mr-2 ml-1 flex shrink-0 flex-col items-center gap-1 self-start rounded-full border border-border bg-card px-1 py-2 shadow-md"
    >
      <Hint label="Session panel" side="left">
        <Button
          data-testid="proto-panel-rail-open"
          variant="ghost"
          size="icon-sm"
          aria-pressed={isTargeting(PANEL_TARGET)}
          onClick={() => state.selectSection(PANEL_TARGET)}
          className={cn(
            'rounded-full text-muted-foreground',
            isTargeting(PANEL_TARGET) && 'bg-sidebar-selection text-primary',
          )}
        >
          <Info />
        </Button>
      </Hint>

      {/*
        `selectSection` already expands its target before scrolling, so a click
        here reveals a collapsed Background Activity section for free — the live
        dot rides the icon whose section the work is in, not the panel opener.
      */}
      <Hint label={RUNNING_COUNT > 0 ? RUNNING_LABEL : 'Background Activity'} side="left">
        <Button
          data-testid="proto-panel-rail-activity"
          variant="ghost"
          size="icon-sm"
          aria-pressed={isTargeting('activity')}
          onClick={() => state.selectSection('activity')}
          className={cn(
            'relative rounded-full text-muted-foreground',
            isTargeting('activity') && 'bg-sidebar-selection text-primary',
          )}
        >
          <Activity />
          {RUNNING_COUNT > 0 && (
            <span className="absolute top-1 right-1 size-1.5 animate-pulse rounded-full bg-primary" />
          )}
        </Button>
      </Hint>

      {/*
        The app's radial usage glyph, reused rather than redrawn — the quota
        footer already answers "how full is it?" with this donut, and a rail is
        too narrow for the header's 8-segment horizontal meter. The percentage
        rides below it because QuotaRing masks its own children away.
      */}
      <Hint label={`Context: ${percent}% used`} side="left">
        <Button
          data-testid="proto-panel-rail-context-usage"
          variant="ghost"
          size="icon-sm"
          onClick={() => state.selectSection(PANEL_TARGET)}
          className="h-auto w-8 flex-col gap-1 rounded-2xl py-1.5 text-muted-foreground"
        >
          <QuotaRing usedPercent={percent} severity={severityOf(percent)} />
          <span className="font-mono text-xs tabular-nums">{percent}%</span>
        </Button>
      </Hint>

      <Separator className="my-0.5 w-4" />

      <Hint label={`Run ${STUB_LAUNCH_CONFIG}`} side="left">
        <Button
          data-testid="proto-panel-rail-launch"
          variant="ghost"
          size="icon-sm"
          className="rounded-full text-muted-foreground"
        >
          <Play />
        </Button>
      </Hint>
    </div>
  );
}

/**
 * Open-state and the scroll ref are props rather than a `SectionId`, because the
 * Plan section has neither — it is local to this variant, so it cannot key into
 * the shared state machine without changing the id union A and B render from.
 */
function Section({
  testId,
  label,
  icon: Icon,
  count,
  open,
  onToggle,
  sectionRef,
  children,
}: {
  testId: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  count?: ReactNode;
  open: boolean;
  onToggle: () => void;
  sectionRef?: (el: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onToggle} asChild>
      <section
        ref={sectionRef}
        data-testid={`proto-panel-section-${testId}`}
        className="shrink-0 border-b border-border last:border-b-0"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            data-testid={`proto-panel-section-toggle-${testId}`}
            className={cn(SECTION_HEAD, 'w-full text-left transition-colors hover:bg-muted')}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{label}</span>
            {count != null && <Badge variant="secondary">{count}</Badge>}
            <span className="flex-1" />
            <ChevronDown
              className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-1.5 px-3 pb-3">{children}</div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

/**
 * The Summary is never collapsible, so its heading is a static row rather than a
 * trigger: same rhythm and ink as the section headers below it, minus the
 * chevron and the hover — nothing here responds to a click.
 */
function Summary({ state }: { state: SessionPanelState }) {
  return (
    <section
      ref={state.registerSection('session')}
      data-testid="proto-panel-section-session"
      className="shrink-0 border-b border-border"
    >
      <div className={SECTION_HEAD}>
        <Info className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">Summary</span>
      </div>
      <div className="flex flex-col gap-1.5 px-3 pb-3">
        <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5">
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">{sessionStub.branch}</span>
          <Badge variant="outline">{sessionStub.worktreeBadge}</Badge>
        </div>
        {/* The token detail moves into the tooltip so Summary stays a uniform
            stack of rows; the ring in the rail is where usage reads graphically. */}
        <Hint label={sessionStub.contextDetail}>
          <div
            data-testid="proto-panel-context-usage-row"
            className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5"
          >
            <Gauge className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm">Context</span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {sessionStub.contextPercent}%
            </span>
          </div>
        </Hint>
        <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5">
          <GitPullRequest className="size-3.5 shrink-0 text-success" />
          <span data-testid="proto-panel-pr" className="min-w-0 flex-1 truncate text-sm">
            PR #{sessionStub.prNumber} · {sessionStub.prState}
          </span>
        </div>
        <button
          type="button"
          data-testid="proto-panel-changes-row"
          className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-left transition-colors hover:bg-accent"
        >
          <GitCompare className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">Changes</span>
          <span className="shrink-0 font-mono text-xs text-success">+{changesTotals.added.toLocaleString()}</span>
          <span className="shrink-0 font-mono text-xs text-destructive">−{changesTotals.removed.toLocaleString()}</span>
        </button>
      </div>
    </section>
  );
}

/**
 * FAITHFUL TRANSCRIPTION of assistant-ui's `agent-plan` element —
 * `packages/ui/src/components/elements/agent-plan.tsx` in assistant-ui/assistant-ui,
 * read from the repo on 2026-08-06 and copied class for class. The real
 * implementation installs the native component
 * (`npx shadcn@latest add "@assistant-ui/elements-agent-plan"`); this copy exists
 * so the prototype previews what will actually ship, not a house redesign of it.
 *
 * Deliberately verbatim, including everything the house style would otherwise
 * reject: the arbitrary type and track sizes (`text-[13.5px]`, `text-[11px]`,
 * `h-[3px]`), the `bg-foreground/[0.06]` fill, and the `text-foreground/35…90`
 * opacity ink tiers instead of the `foreground` / `muted-foreground` scale. Do
 * not tidy these — they are the thing being previewed.
 *
 * Two mechanical substitutions: upstream's `mono` helper from `./surfaces` is
 * inlined below, and its `CheckIcon` / `Loader2Icon` are lucide's pre-v1 names —
 * this repo is on lucide-react 1.25, where the same glyphs are `Check` and
 * `LoaderCircle`.
 */
const AUI_MONO = 'font-mono text-[11px] tracking-tight';

function AgentPlan({
  steps,
  activeIndex,
  className,
  open,
  onToggle,
}: {
  steps: readonly string[];
  activeIndex: number;
  className?: string;
  /** OUR MODIFICATION — not upstream props. See the header note. */
  open: boolean;
  onToggle: () => void;
}) {
  const total = steps.length;
  const allDone = activeIndex >= total;
  const completed = allDone ? total : activeIndex;
  const progress = total === 0 ? 0 : (completed / total) * 100;

  return (
    /*
     * OUR MODIFICATION, kept to the smallest possible edit: a `Collapsible`
     * around the element, the header row turned into its trigger with a chevron
     * after the counter, and the step `<ul>` moved into `CollapsibleContent`.
     * Collapsed therefore keeps upstream's header AND progress bar visible and
     * hides only the steps. The chevron takes the counter's own `text-foreground/35`
     * rather than the panel's `muted-foreground`, so the element stays internally
     * consistent. Every other class below is still upstream's, untouched.
     */
    <Collapsible open={open} onOpenChange={onToggle} asChild>
      <div className={cn('flex w-full max-w-sm flex-col gap-3', className)}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            data-testid="proto-panel-section-toggle-plan"
            className="flex w-full items-center justify-between"
          >
            <span className="text-[13.5px] font-medium">Plan</span>
            <span className="flex items-center gap-1.5">
              <span className={cn(AUI_MONO, 'text-foreground/35 tabular-nums')}>
                {completed} of {total}
              </span>
              <ChevronDown
                className={cn('size-3 shrink-0 text-foreground/35 transition-transform', open && 'rotate-180')}
              />
            </span>
          </button>
        </CollapsibleTrigger>
        <div className="h-[3px] w-full overflow-hidden rounded-full bg-foreground/[0.06]">
          <span
            className="block h-full rounded-full bg-foreground/80 transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <CollapsibleContent asChild>
          <ul className="flex flex-col gap-2.5">
            {steps.map((step, i) => {
              const done = allDone || i < activeIndex;
              const active = !allDone && i === activeIndex;
              return (
                <li key={step} className="flex items-center gap-2.5 text-[13.5px]">
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {done ? (
                      <Check className="size-3.5 text-foreground/35" />
                    ) : active ? (
                      <LoaderCircle className="size-3.5 animate-spin text-foreground/90 motion-reduce:animate-none" />
                    ) : (
                      <span aria-hidden className="size-1.5 rounded-full bg-foreground/15" />
                    )}
                  </span>
                  <span
                    className={cn(
                      done && 'text-foreground/40',
                      active && 'text-foreground/90',
                      !done && !active && 'text-foreground/35',
                    )}
                  >
                    {step}
                  </span>
                </li>
              );
            })}
          </ul>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/**
 * Every row here is running, so the spinner is the uniform leading glyph rather
 * than a per-row state signal — the kinds (a workflow, a background agent) are
 * distinguished by their own text.
 */
function BackgroundActivityBody() {
  return (
    <>
      {backgroundActivityStub.map((task) => (
        <div
          key={task.id}
          data-testid={`proto-panel-task-${task.id}`}
          className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5"
        >
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{task.title}</div>
            <div className="truncate text-xs text-muted-foreground">{task.detail}</div>
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Same tile recipe the chat surface already uses for message attachments
 * (`features/chat/messages/UserAttachments.tsx`): the v2 `Attachment` compound,
 * a `.ext` label over an `extTint` wash for files, `variant="image"` for images.
 * Reused rather than redrawn so an attachment reads as the same object in the
 * transcript and in the panel. `orientation="vertical"` is the tile form; its
 * fixed `w-24` is overridden to `w-full` because the grid owns the width here.
 */
function AttachmentTile({ attachment }: { attachment: AttachmentStub }) {
  const meta = fileExtMeta(attachment.name);
  const isImage = isImageAttachment(attachment.name);

  return (
    <Hint label={`${attachment.name} · ${attachment.size}`}>
      {/* Default size, not `sm`: `sm` sets the media to `w-8` with the same
          variant weight as vertical's `w-full`, and source order wins — the thumb
          collapses to 32px in a 90px tile (measured). */}
      <Attachment data-testid={`proto-panel-attachment-${attachment.id}`} orientation="vertical" className="w-full">
        {isImage ? (
          <AttachmentMedia variant="image">
            {/* No image assets in a prototype — a wash plus the glyph stands in
                for the thumbnail the real tile would render. */}
            <div className="absolute inset-0 bg-gradient-to-br from-muted-foreground/25 to-muted-foreground/5" />
            <Image className="relative size-5 text-muted-foreground/70" />
          </AttachmentMedia>
        ) : (
          <AttachmentMedia style={{ background: extTint(meta.color) }}>
            <span className="font-mono text-xs font-bold" style={{ color: meta.color }}>
              .{meta.ext}
            </span>
          </AttachmentMedia>
        )}
      </Attachment>
    </Hint>
  );
}

function ContextBody() {
  return (
    <>
      {CONTEXT_GROUPS.map((group) => (
        <div key={group.id} className="rounded-md bg-muted p-1.5">
          <div className="flex items-center gap-1.5 px-1 pb-1">
            <span className="text-xs font-medium text-muted-foreground">{group.label}</span>
            <Badge variant="outline">{group.items.length}</Badge>
          </div>
          {group.items.map((item) => (
            <div
              key={item.id}
              data-testid={`proto-panel-context-${group.id}-${item.id}`}
              className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-background"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.detail}</span>
            </div>
          ))}
        </div>
      ))}
      <div className="rounded-md bg-muted p-1.5">
        <div className="flex items-center gap-1.5 px-1 pb-1.5">
          <span className="text-xs font-medium text-muted-foreground">Attachments</span>
          <Badge variant="outline">{attachmentsStub.length}</Badge>
        </div>
        <div data-testid="proto-panel-attachment-grid" className="grid grid-cols-3 gap-1.5">
          {attachmentsStub.map((attachment) => (
            <AttachmentTile key={attachment.id} attachment={attachment} />
          ))}
        </div>
      </div>
    </>
  );
}

function PanelInner({
  state,
  planOpen,
  onTogglePlan,
}: {
  state: SessionPanelState;
  planOpen: boolean;
  onTogglePlan: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <Summary state={state} />
      {/* No section header of its own: the upstream element ships one, and it
          doubles as the collapse trigger. */}
      <div data-testid="proto-panel-section-plan" className="shrink-0 border-b border-border px-3 py-3">
        <AgentPlan steps={planStepsStub} activeIndex={planActiveIndex} open={planOpen} onToggle={onTogglePlan} />
      </div>
      <Section
        testId="activity"
        label="Background Activity"
        icon={Activity}
        count={RUNNING_COUNT}
        open={state.isSectionOpen('activity')}
        onToggle={() => state.toggleSection('activity')}
        sectionRef={state.registerSection('activity')}
      >
        <BackgroundActivityBody />
      </Section>
      <Section
        testId="context"
        label={SECTION_LABEL.context}
        icon={Layers}
        count={CONTEXT_COUNT}
        open={state.isSectionOpen('context')}
        onToggle={() => state.toggleSection('context')}
        sectionRef={state.registerSection('context')}
      >
        <ContextBody />
      </Section>
    </div>
  );
}

export function VariantCFloatingPanel({ state }: { state: SessionPanelState }) {
  const { mode } = state;
  // Plan has no `SectionId`, so its open-state can't live in the shared hook
  // without changing the id union A and B render from. It lives here, at the
  // root, which survives the inline↔overlay swap that unmounts the panel body.
  const [planOpen, setPlanOpen] = useState(false);
  const togglePlan = useCallback(() => setPlanOpen((open) => !open), []);

  return (
    <div ref={state.rootRef} data-testid="proto-panel-root" data-proto-variant="C" className="relative flex h-full">
      {mode === 'inline' && (
        <div data-testid="proto-panel" className={cn(PANEL_CHROME, 'my-2 ml-2 shadow-lg')}>
          <PanelInner state={state} planOpen={planOpen} onTogglePlan={togglePlan} />
        </div>
      )}
      {mode === 'overlay' && (
        <div
          data-testid="proto-panel-overlay"
          className={cn(PANEL_CHROME, 'absolute top-2 right-full bottom-2 z-30 shadow-xl')}
        >
          <PanelInner state={state} planOpen={planOpen} onTogglePlan={togglePlan} />
        </div>
      )}
      <Rail state={state} />
    </div>
  );
}
