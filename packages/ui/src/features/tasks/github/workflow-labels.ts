/**
 * Mainframe's own pipeline vocabulary, mirrored from the daemon's denylist
 * (`todos_github/labels.rs`) so the publish dialog can show the exact payload
 * before anything is created. The daemon remains authoritative — this copy only
 * previews what it will send.
 */

const WORKFLOW_LABEL_PREFIXES = ['route:', 'gate:', 'approved:', 'rework:', 'pipeline:', 'pr:', 'wayfinder:'];

const WORKFLOW_LABELS = [
  'needs-triage',
  'needs-info',
  'ready-for-agent',
  'ready-for-human',
  'wontfix',
  'parked',
  'dispatched',
];

export function isWorkflowLabel(label: string): boolean {
  return WORKFLOW_LABELS.includes(label) || WORKFLOW_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix));
}

export interface PartitionedLabels {
  syncable: string[];
  withheld: string[];
}

export function partitionLabels(labels: string[]): PartitionedLabels {
  const syncable: string[] = [];
  const withheld: string[] = [];
  for (const label of labels) (isWorkflowLabel(label) ? withheld : syncable).push(label);
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
