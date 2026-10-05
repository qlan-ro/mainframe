/**
 * PullRequestsSection — the session's detected pull requests, pulled out of
 * the Summary rows into their own eyebrow section. Each row opens the PR in
 * the system browser. Renders nothing when the session has none — unlike
 * Activity, an empty "Pull requests" header would be an affordance for data
 * that does not exist.
 */
import { useAuiState } from '@assistant-ui/react';
import { GitPullRequest } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { activeSessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { useHost } from '@/lib/host';
import { PanelEyebrow } from './PanelEyebrow';

const ROW = 'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-foreground/8';

export function PullRequestsSection() {
  const host = useHost();
  const prs = useAuiState((s) => activeSessionCustom(s.threadListItem, s.threads.threadItems))?.detectedPrs ?? [];
  if (prs.length === 0) return null;

  return (
    <section data-testid="session-panel-section-prs" className="shrink-0 border-b border-border">
      <PanelEyebrow label="Pull requests" />
      <div className="flex flex-col gap-0.5 px-2 pb-2">
        {prs.map((pr) => (
          <Hint key={pr.number} label={pr.url}>
            <button
              type="button"
              data-testid={`session-panel-summary-pr-${pr.number}`}
              onClick={() => void host.shell.openExternal(pr.url)}
              className={ROW}
            >
              <GitPullRequest className="size-3.5 shrink-0 text-success" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm">
                {pr.owner}/{pr.repo}#{pr.number}
              </span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{pr.source}</span>
            </button>
          </Hint>
        ))}
      </div>
    </section>
  );
}
