/**
 * RepairPrompt — 401 re-pair prompt rendered as a Dialog.
 *
 * Shown when a remote daemon rejects the stored access token (revoked/expired).
 * The user can either switch to the local daemon or initiate re-pairing.
 *
 * Visual spec: 17-daemon.jsx RepairPrompt artboard.
 * Token mapping: task-B8-brief.md.
 */
import { Lock, Laptop } from 'lucide-react';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RepairPromptProps {
  target: DaemonMeta;
  onRepair: () => void;
  onSwitchLocal: () => void;
  onDismiss: () => void;
}

// ---------------------------------------------------------------------------
// StatusChip — host + 401 badge
// ---------------------------------------------------------------------------

function StatusChip({ host }: { host: string }) {
  return (
    <div className="flex items-center gap-[6px] rounded-md border border-border bg-card px-[10px] py-[6px]">
      <span className="font-mono text-caption text-mf-text-3 truncate">{host}</span>
      <span className="shrink-0 rounded-xs bg-mf-warning/15 px-[5px] py-px font-mono text-micro font-bold text-mf-warning">
        401
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RepairPromptBody — the inner card (no Dialog wrapper — used standalone too)
// ---------------------------------------------------------------------------

export function RepairPromptBody({ target, onRepair, onSwitchLocal }: Omit<RepairPromptProps, 'onDismiss'>) {
  return (
    <div
      data-testid="daemon-repair-prompt"
      className="flex w-[400px] max-w-full flex-col items-center gap-[16px] px-[4px] py-[4px] text-center"
    >
      {/* Amber lock tile */}
      <div className="flex size-[46px] shrink-0 items-center justify-center rounded-lg bg-mf-warning/15">
        <Lock size={20} className="text-mf-warning" aria-hidden />
      </div>

      {/* Title + body copy */}
      <div className="flex flex-col gap-[6px]">
        <h2 className="text-heading font-semibold text-foreground leading-tight">{target.label} needs re-pairing</h2>
        <p className="text-body text-muted-foreground leading-normal max-w-[320px]">
          The server rejected your access token (revoked or expired). Re-pair to get a fresh token, or keep working on
          this Mac.
        </p>
      </div>

      {/* Host chip with 401 badge */}
      {target.host != null && <StatusChip host={target.host} />}

      {/* Action buttons */}
      <div className="flex w-full flex-col gap-[8px] pt-[2px]">
        <Button data-testid="daemon-repair-confirm" className="w-full" onClick={onRepair}>
          <Lock size={14} aria-hidden />
          Re-pair
        </Button>
        <Button data-testid="daemon-repair-switchlocal" variant="outline" className="w-full" onClick={onSwitchLocal}>
          <Laptop size={14} aria-hidden />
          Switch to This Mac
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RepairPrompt (Dialog-wrapped)
// ---------------------------------------------------------------------------

export function RepairPrompt({ target, onRepair, onSwitchLocal, onDismiss }: RepairPromptProps) {
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onDismiss();
      }}
    >
      <DialogContent className="p-[24px] max-w-[440px]" hideClose>
        <RepairPromptBody target={target} onRepair={onRepair} onSwitchLocal={onSwitchLocal} />
      </DialogContent>
    </Dialog>
  );
}
