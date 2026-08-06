import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@v2/components/ui/alert';

interface ConfigConflictsWarningProps {
  conflicts: string[];
}

/** Renders a warning banner when Claude Code's settings.json defines fields
 *  that Mainframe will override. Renders nothing when the list is empty. */
export function ConfigConflictsWarning({ conflicts }: ConfigConflictsWarningProps) {
  if (conflicts.length === 0) return null;

  return (
    <Alert data-testid="settings-config-conflicts-warning" className="border-warning/30 bg-warning/10">
      <AlertTriangle className="text-warning" />
      <AlertDescription className="text-xs text-foreground">
        Claude Code settings.json defines {conflicts.join(', ')}. Mainframe flags will take precedence when launching
        sessions.
      </AlertDescription>
    </Alert>
  );
}
