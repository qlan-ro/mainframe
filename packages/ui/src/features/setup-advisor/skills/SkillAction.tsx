/**
 * SkillAction — the one control in a skill row's trailing slot.
 *
 * Scope is asked at the moment of installing rather than set on a toolbar
 * beforehand: it is a property of the install you are making, not a mode the
 * panel is in, and a control set minutes ago is a control you have stopped
 * reading.
 *
 * An installed row reads as spent — "Installed", styled quiet — and swaps to
 * Uninstall on hover or focus. It is not actually `disabled`: a disabled
 * button takes no focus, which would put uninstall out of reach of the
 * keyboard entirely. What you click is always what the label says.
 */
import { Check, Loader2, Trash2 } from 'lucide-react';
import type { SkillsCliScope } from '@qlan-ro/mainframe-types';
import { Button } from '@v2/components/ui/button';
import { MenuRow } from '@/components/ui/menu';
import { Popover, PopoverContent, PopoverTrigger } from '@v2/components/ui/popover';
import { cn } from '@/lib/utils';
import { SCOPE_LABEL } from './scope-label';
import type { SkillRow } from './skill-rows';

interface SkillActionProps {
  row: SkillRow;
  /** This row's install or uninstall is in flight. */
  running: boolean;
  /** Any skills-CLI operation is in flight — one at a time, per project. */
  disabled: boolean;
  /** The row is hovered or holds focus, so an installed row offers Uninstall. */
  revealed: boolean;
  openScope: boolean;
  onOpenScope: (open: boolean) => void;
  onInstall: (row: SkillRow, scope: SkillsCliScope) => void;
  onUninstall: (row: SkillRow, scope: SkillsCliScope) => void;
}

export function SkillAction(props: SkillActionProps) {
  const { row, running, disabled, revealed, openScope, onOpenScope } = props;
  const { onInstall, onUninstall } = props;
  const testId = `skills-row-action-${row.key}`;

  if (running) {
    return (
      <Button type="button" variant="ghost" size="sm" data-testid={testId} aria-busy disabled>
        <Loader2 className="animate-spin" aria-hidden />
        {row.scopes.length > 0 ? 'Removing' : 'Installing'}
      </Button>
    );
  }

  if (row.scopes.length > 0) {
    const label = revealed ? 'Uninstall' : 'Installed';
    const only = row.scopes.length === 1 ? row.scopes[0] : undefined;
    const trigger = (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid={testId}
        disabled={disabled}
        className={cn(revealed ? 'text-destructive hover:text-destructive' : 'text-muted-foreground')}
        onClick={only ? () => onUninstall(row, only) : undefined}
      >
        {revealed ? <Trash2 aria-hidden /> : <Check aria-hidden />}
        {label}
      </Button>
    );

    // Installed in both scopes: uninstalling has to say which one it means.
    if (only) return trigger;
    return (
      <ScopePopover
        row={row}
        scopes={row.scopes}
        open={openScope}
        onOpenChange={onOpenScope}
        trigger={trigger}
        onPick={onUninstall}
      />
    );
  }

  return (
    <ScopePopover
      row={row}
      scopes={['project', 'global']}
      open={openScope}
      onOpenChange={onOpenScope}
      onPick={onInstall}
      trigger={
        <Button type="button" variant="ghost" size="sm" data-testid={testId} disabled={disabled}>
          Install
        </Button>
      }
    />
  );
}

interface ScopePopoverProps {
  row: SkillRow;
  scopes: readonly SkillsCliScope[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  onPick: (row: SkillRow, scope: SkillsCliScope) => void;
}

function ScopePopover({ row, scopes, open, onOpenChange, trigger, onPick }: ScopePopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent data-testid={`skills-row-scope-${row.key}`} className="w-40" align="end">
        {scopes.map((scope) => (
          <MenuRow
            key={scope}
            data-testid={`skills-row-scope-${row.key}-${scope}`}
            label={SCOPE_LABEL[scope]}
            onClick={() => {
              onOpenChange(false);
              onPick(row, scope);
            }}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}
