import { AlertTriangle } from 'lucide-react';

interface ConfigConflictsWarningProps {
  conflicts: string[];
}

/** Renders a warning banner when Claude Code's settings.json defines fields
 *  that Mainframe will override. Renders nothing when the list is empty. */
export function ConfigConflictsWarning({ conflicts }: ConfigConflictsWarningProps) {
  if (conflicts.length === 0) return null;

  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-yellow-500/10 border border-yellow-500/30">
      <AlertTriangle size={14} className="text-yellow-500 shrink-0 mt-0.5" />
      <p className="text-xs text-yellow-500">
        Claude Code settings.json defines {conflicts.join(', ')}. Mainframe flags will take precedence when launching
        sessions.
      </p>
    </div>
  );
}
