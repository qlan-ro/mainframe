/**
 * Says once, in words, what the neutralized rows below say in ornament: the CLI
 * died with agents mid-flight, so their outcome was never observed (AC 18).
 *
 * Only a stopped run earns the banner. A completed or failed run neutralizes the
 * same rows (A9), but its own outcome is known, and a banner there would read as
 * an error report on a run that ended fine.
 */
import { CircleSlash } from 'lucide-react';
import { staleAgents, staleGapSeconds, type ViewRun } from './workflow-agent-view';
import { runKey } from './workflow-progress';

export function WorkflowStaleBanner({ run, now }: { run: ViewRun; now: number }) {
  const stale = staleAgents(run.agents);
  if (run.status !== 'stopped' || stale.length === 0) return null;

  // The freshest neutralized agent bounds how blind the snapshot actually was.
  const gap = Math.min(...stale.map((agent) => staleGapSeconds(run, agent, now)));

  return (
    <div
      data-testid={`chat-workflow-stale-banner-${runKey(run)}`}
      className="mx-0.5 mb-1.5 flex items-start gap-2 rounded-md bg-muted px-2 py-1.5"
    >
      <CircleSlash size={12} className="mt-px shrink-0 text-muted-foreground" aria-hidden />
      <p className="text-caption leading-normal text-muted-foreground">
        The CLI process ended. {stale.length} agent{stale.length === 1 ? ' was' : 's were'} still running in the last
        snapshot, {gap}s before it stopped — their outcome is unknown.
      </p>
    </div>
  );
}
