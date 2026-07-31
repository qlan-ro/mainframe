/**
 * Mainframe's own pipeline vocabulary, partitioned out of a task's labels
 * before publishing. The denylist itself is NOT restated here — it's fetched
 * from the daemon (`todos_github::labels`, the sole source) via `GET /link`'s
 * `workflowLabels` field and threaded in by the caller, so the publish
 * dialog's preview can never drift from what a sync run actually withholds.
 */
import type { WorkflowLabelSet } from '@/lib/api/todos-github';

export function isWorkflowLabel(label: string, set: WorkflowLabelSet): boolean {
  return set.labels.includes(label) || set.prefixes.some((prefix) => label.startsWith(prefix));
}

export interface PartitionedLabels {
  syncable: string[];
  withheld: string[];
}

export function partitionLabels(labels: string[], set: WorkflowLabelSet): PartitionedLabels {
  const syncable: string[] = [];
  const withheld: string[] = [];
  for (const label of labels) (isWorkflowLabel(label, set) ? withheld : syncable).push(label);
  return { syncable, withheld };
}

/** Empty when nothing is withheld, so the dialog can omit the sentence entirely. */
export function withheldLabelsSentence(withheld: string[]): string {
  if (withheld.length === 0) return '';
  const noun = withheld.length === 1 ? 'workflow label stays' : 'workflow labels stay';
  return (
    `${withheld.length} ${noun} local — ${withheld.join(', ')}. ` +
    "Mainframe's pipeline labels are never published and never accepted back from GitHub."
  );
}
