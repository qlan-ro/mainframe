import { AlertTriangle } from 'lucide-react';

interface ConfigConflictsWarningProps {
  conflicts: string[];
}

/** Renders a warning banner when Claude Code's settings.json defines fields
 *  that Mainframe will override. Renders nothing when the list is empty. */
export function ConfigConflictsWarning({ conflicts }: ConfigConflictsWarningProps) {
  if (conflicts.length === 0) return null;

  return (
    <div
      data-testid="settings-config-conflicts-warning"
      className="flex items-start gap-2 px-3 py-2 rounded-md bg-mf-warning-tint border border-mf-warning/30"
    >
      <AlertTriangle size={14} className="text-mf-warning shrink-0 mt-0.5" />
      <p className="text-label text-foreground">
        Claude Code settings.json defines {conflicts.join(', ')}. Mainframe flags will take precedence when launching
        sessions.
      </p>
    </div>
  );
}
