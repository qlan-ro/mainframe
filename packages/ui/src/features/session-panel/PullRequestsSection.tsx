/**
 * PullRequestsSection — the session's detected pull requests. Each row opens
 * the PR in the system browser. Renders nothing when the session has none — an
 * empty "Pull requests" header would be an affordance for data that does not exist.
 */
import { useAuiState } from '@assistant-ui/react';
import { GitPullRequest } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { activeSessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { useHost } from '@/lib/host';
import { PanelRow, PanelSection } from './PanelSection';

export function PullRequestsSection() {
  const host = useHost();
  const prs = useAuiState((s) => activeSessionCustom(s.threadListItem, s.threads.threadItems))?.detectedPrs ?? [];
  if (prs.length === 0) return null;

  return (
    <PanelSection section="prs" data-testid="session-panel-section-prs">
      {prs.map((pr) => (
        <Hint key={pr.url} label={pr.url}>
          <PanelRow
            data-testid={`session-panel-summary-pr-${pr.number}`}
            onClick={() => void host.shell.openExternal(pr.url)}
            icon={<GitPullRequest className="text-success" />}
            label={`${pr.owner}/${pr.repo}#${pr.number}`}
            value={pr.source}
          />
        </Hint>
      ))}
    </PanelSection>
  );
}
