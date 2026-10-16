import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';

interface ProviderCliManualCommandProps {
  adapterId: string;
  /** The sentence above the snippet — differs by why the in-app Update path isn't offered. */
  lead: string;
  command: string;
}

/**
 * A copyable monospace command snippet — shown when the in-app Update button isn't
 * offered (unknown install method, or a permission-denied run) so the user can still
 * run the exact command by hand.
 */
export function ProviderCliManualCommand({ adapterId, lead, command }: ProviderCliManualCommandProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      /* expected — clipboard may not be available in all contexts */
      console.warn('[settings/ProviderCliManualCommand] clipboard write failed', err);
    }
  }, [command]);

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{lead}</p>
      <div
        data-testid={`settings-${adapterId}-cli-manual-command`}
        className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1.5"
      >
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{command}</code>
        <Hint label="Copy">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleCopy}
            aria-label="Copy"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </Hint>
      </div>
    </div>
  );
}
