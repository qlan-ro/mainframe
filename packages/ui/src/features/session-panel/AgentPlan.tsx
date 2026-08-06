/**
 * AgentPlan — an OWNED FORK of assistant-ui's `agent-plan` registry element.
 *
 * Upstream: `@assistant-ui/elements-agent-plan`, fetched 2026-08-06 from
 * https://r.assistant-ui.com/elements-agent-plan.json
 * (payload `last-modified: Thu, 06 Aug 2026 16:26:01 GMT`; sha256 of the file
 * body e3142dde09ee76adb0d1cdc1f839c69ba6c082c26892352e063e6a451b290d4b). The
 * registry item carries no version, so re-pull that URL and diff its `content`
 * against this file.
 *
 * FETCHED, NOT CLI-INSTALLED. `shadcn@4.16.1 add` cannot run against
 * `src/v2/components.json`: the CLI now opens with an interactive "select a
 * component library" prompt this config predates, and answering it rewrites the
 * config and pulls a base-library dependency set. Same trap, same fallback the
 * chat-kit port took. The `@assistant-ui` registry entry in `components.json`
 * records where the element comes from for whenever that is sorted out.
 *
 * FORKED rather than wrapped because the design needs upstream's own header row
 * to double as the section's collapse trigger — an edit to the component's
 * internals, which a wrapper cannot reach. No stock copy lives under
 * `v2/components/**`: an unmodified one would have to import `./surfaces` for a
 * single three-class string, dragging in that 94-line module and its `tw-shimmer`
 * dependency for a `shimmer` utility this app already rejected as phantom.
 *
 * Three deviations from upstream, all mechanical:
 *   1. `"use client"` dropped — no file in the v2 tree carries it (`rsc: false`).
 *   2. `cn` comes from `@v2/lib/utils`, this tree's alias for `@/lib/utils`.
 *   3. `mono` is inlined instead of imported from `./surfaces`, verbatim.
 *
 * One behavioral fork, the reason this file exists: a `Collapsible` wraps the
 * element, upstream's header row becomes its trigger (a chevron joins the
 * counter), and only the step `<ul>` moves into `CollapsibleContent` — so
 * collapsed keeps the header AND the progress bar visible. It is an edit to the
 * component's internals; a wrapper cannot reach between the header and the bar.
 * The chevron takes the counter's own `text-foreground/35` rather than the
 * panel's `muted-foreground`, so the element stays internally consistent, and
 * the testids are the panel's because the panel is this fork's only consumer.
 *
 * Everything else is upstream's, deliberately, including what the house style
 * would otherwise reject: the arbitrary sizes (`text-[13.5px]`, `text-[11px]`,
 * `h-[3px]`), the `bg-foreground/[0.06]` track, and the `text-foreground/15…90`
 * opacity ink tiers in place of the `foreground` / `muted-foreground` scale.
 * Those are the render the design approved — do not "correct" them to the scale.
 */
import { CheckIcon, ChevronDown, Loader2Icon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@v2/components/ui/collapsible';
import { cn } from '@v2/lib/utils';

/** Upstream's `mono` recipe from `elements-surfaces`, inlined. */
const mono = 'font-mono text-[11px] tracking-tight';

export function AgentPlan({
  steps,
  activeIndex,
  className,
  open,
  onToggle,
}: {
  steps: readonly string[];
  activeIndex: number;
  className?: string;
  /** FORK — upstream has no collapse. See the header note. */
  open: boolean;
  onToggle: () => void;
}) {
  const total = steps.length;
  const allDone = activeIndex >= total;
  const completed = allDone ? total : activeIndex;
  const progress = total === 0 ? 0 : (completed / total) * 100;

  return (
    <Collapsible open={open} onOpenChange={onToggle} asChild>
      <div className={cn('flex w-full max-w-sm flex-col gap-3', className)}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            data-testid="session-panel-plan-toggle"
            className="flex w-full items-center justify-between"
          >
            <span className="text-[13.5px] font-medium">Plan</span>
            <span className="flex items-center gap-1.5">
              <span className={cn(mono, 'text-foreground/35 tabular-nums')}>
                {completed} of {total}
              </span>
              <ChevronDown
                className={cn('size-3 shrink-0 text-foreground/35 transition-transform', open && 'rotate-180')}
              />
            </span>
          </button>
        </CollapsibleTrigger>
        <div
          data-testid="session-panel-plan-progress"
          className="bg-foreground/[0.06] h-[3px] w-full overflow-hidden rounded-full"
        >
          <span
            className="bg-foreground/80 block h-full rounded-full transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <CollapsibleContent asChild>
          <ul className="flex flex-col gap-2.5">
            {steps.map((step, i) => {
              const done = allDone || i < activeIndex;
              const active = !allDone && i === activeIndex;
              return (
                // Index-keyed testid: a plan step has no domain id, and its
                // position IS its identity.
                <li
                  key={step}
                  data-testid={`session-panel-plan-step-${i}`}
                  className="flex items-center gap-2.5 text-[13.5px]"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {done ? (
                      <CheckIcon className="text-foreground/35 size-3.5" />
                    ) : active ? (
                      <Loader2Icon className="text-foreground/90 size-3.5 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <span aria-hidden className="bg-foreground/15 size-1.5 rounded-full" />
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
