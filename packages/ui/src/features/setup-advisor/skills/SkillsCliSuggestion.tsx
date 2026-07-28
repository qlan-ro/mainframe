/**
 * A dismissible pointer to the `skills` CLI for installing skills from a
 * registry — the section itself never depends on it.
 *
 * It is unconditional because the renderer cannot run a process and no daemon
 * route reports whether the CLI is installed, so "detected" is not a state this
 * app can know today. A suggestion is correct either way; a claim would not be.
 */
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { copyCommand } from '../copy-command';

const INSTALL_COMMAND = 'npx skills add <owner>/<repo> --skill <name> -a claude-code';
const COPIED_REVERT_MS = 1500;

export function SkillsCliSuggestion({ onDismiss }: { onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await copyCommand(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_REVERT_MS);
    } catch {
      /* expected — a denied clipboard leaves the command visible to select */
    }
  }

  return (
    <div
      data-testid="skills-section-cli-suggestion"
      className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-caption text-muted-foreground"
    >
      <span className="flex-shrink-0">Add skills from a registry:</span>
      <span className="min-w-0 flex-1 select-text truncate font-mono text-caption text-foreground">
        {INSTALL_COMMAND}
      </span>
      <button
        type="button"
        data-testid="skills-section-cli-copy"
        onClick={() => void handleCopy()}
        className={cn(
          'flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 transition-colors',
          copied ? 'text-mf-success' : 'hover:bg-accent hover:text-foreground',
        )}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button
        type="button"
        data-testid="skills-section-cli-dismiss"
        onClick={onDismiss}
        className="flex-shrink-0 rounded-md px-2 py-1 transition-colors hover:bg-accent hover:text-foreground"
      >
        Dismiss
      </button>
    </div>
  );
}
