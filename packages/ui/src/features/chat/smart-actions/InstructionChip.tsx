'use client';

/**
 * The #278 chip: the instruction as real DOM text plus two icon-only actions.
 *
 * One component for all four detection seams. The block variant is the same
 * chip inside a container — deliberately not a card and not a header row, so a
 * standalone instruction keeps the paragraph's rhythm.
 */
import { CornerDownLeft, MessageSquarePlus } from 'lucide-react';
import { useInstructionActions } from './use-instruction-actions';
import type { InstructionChipTarget } from './use-instruction-chip';

const CHIP_CLASS =
  'inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 pl-1.5 pr-1 py-0.5 align-baseline';
const ICON_BUTTON_CLASS = 'rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground';
const BLOCK_CONTAINER_CLASS = 'rounded-lg border border-border bg-muted/40 px-3 py-2';

interface InstructionChipProps {
  target: InstructionChipTarget;
  /** `block` wraps the same chip in the standalone-instruction container. */
  variant?: 'inline' | 'block';
}

export function InstructionChip({ target, variant = 'inline' }: InstructionChipProps) {
  const { append, runInNewSession } = useInstructionActions();

  const chip = (
    <span className={CHIP_CLASS} data-smart-action-token={target.token}>
      <code className="font-mono text-xs">{target.insertText}</code>
      <button
        type="button"
        data-testid="smart-action-instruction-append"
        title="Add to composer"
        aria-label="Add to composer"
        className={ICON_BUTTON_CLASS}
        onClick={() => append(target.insertText)}
      >
        <CornerDownLeft className="size-3.5" />
      </button>
      <button
        type="button"
        data-testid="smart-action-instruction-new-session"
        title="Run in a new session"
        aria-label="Run in a new session"
        className={ICON_BUTTON_CLASS}
        onClick={() => runInNewSession(target.insertText)}
      >
        <MessageSquarePlus className="size-3.5" />
      </button>
    </span>
  );

  if (variant === 'block') return <div className={BLOCK_CONTAINER_CLASS}>{chip}</div>;
  return chip;
}
