/**
 * AutomationDetails — read-only Overview/Runs details view for a library
 * row (todo #233). `LibraryRow`'s click handler already routes straight to
 * `RunView` when there's exactly one run, so by the time this mounts, this
 * automation's runs are 0 or 2+ — the initial tab reflects that ("Runs"
 * when there's history to browse, "Overview" otherwise).
 *
 * Self-sufficient like `AutomationEditor`/`RunView`: reads
 * `use-automations-nav`/`use-automations-store` directly rather than taking
 * props — `AutomationsView` only decides WHETHER to mount this.
 */
import { useMemo, useState } from 'react';
import { ChevronLeft, Pencil, Play, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { mfToast } from '@/lib/toast';
import { useAutomationsNav } from '../data/use-automations-nav';
import { useAutomationsStore } from '../data/use-automations-store';
import { DetailsOverview } from './DetailsOverview';
import { DetailsRuns } from './DetailsRuns';

type DetailsTab = 'overview' | 'runs';

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

export function AutomationDetails() {
  const automationId = useAutomationsNav((s) => s.detailsAutomationId);
  const closeDetails = useAutomationsNav((s) => s.closeDetails);
  const openEditor = useAutomationsNav((s) => s.openEditor);
  const openRun = useAutomationsNav((s) => s.openRun);
  const definitions = useAutomationsStore((s) => s.definitions);
  const allRuns = useAutomationsStore((s) => s.runs);
  const catalog = useAutomationsStore((s) => s.catalog);
  const gateway = useAutomationsStore((s) => s.gateway);
  const patchRun = useAutomationsStore((s) => s.patchRun);
  const [starting, setStarting] = useState(false);

  const automation = definitions.find((d) => d.id === automationId);
  const runs = useMemo(
    () => allRuns.filter((r) => r.automationId === automationId).sort((a, b) => b.startedAt - a.startedAt),
    [allRuns, automationId],
  );

  const [tab, setTab] = useState<DetailsTab>(() => (runs.length > 0 ? 'runs' : 'overview'));

  async function handleRunNow(): Promise<void> {
    if (!automation || starting) return;
    setStarting(true);
    try {
      const run = await gateway.startRun(automation.id);
      patchRun(run);
      openRun(run.id);
    } catch (err) {
      mfToast.error('Could not start the run', { description: errorMessage(err) });
    } finally {
      setStarting(false);
    }
  }

  if (!automationId) return null;

  if (!automation) {
    return (
      <div
        data-testid="automations-details-not-found"
        className="flex h-full items-center justify-center text-body text-muted-foreground"
      >
        This automation couldn't be found.
      </div>
    );
  }

  return (
    <div data-testid="automations-details" className="flex h-full min-h-0 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-[11px] border-b border-border px-[16px]">
        <Hint label="Back">
          <button
            type="button"
            data-testid="automations-details-back"
            onClick={closeDetails}
            className="flex size-[28px] items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent"
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
        </Hint>
        <Zap size={15} className="text-primary" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-heading font-bold tracking-tight text-foreground">
          {automation.name}
        </span>
        <button
          type="button"
          data-testid="automations-details-run"
          disabled={starting}
          onClick={() => void handleRunNow()}
          className="inline-flex h-[28px] items-center gap-[5px] rounded-md border-[0.5px] border-border px-[12px] text-caption font-semibold text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Play size={14} className="text-primary" fill="currentColor" aria-hidden />
          Run now
        </button>
        <Hint label="Edit">
          <button
            type="button"
            data-testid="automations-details-edit"
            onClick={() => openEditor({ mode: 'edit', automationId: automation.id })}
            className="flex size-[28px] items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent"
          >
            <Pencil size={14} aria-hidden />
          </button>
        </Hint>
      </div>

      <div className="flex shrink-0 items-center border-b border-border p-[10px]">
        <div className="flex items-center gap-[2px] rounded-[6px] bg-muted p-[2px]">
          {(['overview', 'runs'] as const).map((t) => (
            <button
              key={t}
              type="button"
              data-testid={`automations-details-tab-${t}`}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-[5px] px-[12px] py-[4px] text-caption transition-colors',
                tab === t
                  ? 'bg-popover font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t === 'overview' ? 'Overview' : `Runs${runs.length > 0 ? ` (${runs.length})` : ''}`}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'overview' ? (
          <DetailsOverview description={automation.description} definition={automation.definition} catalog={catalog} />
        ) : (
          <DetailsRuns runs={runs} onOpenRun={openRun} />
        )}
      </div>
    </div>
  );
}
