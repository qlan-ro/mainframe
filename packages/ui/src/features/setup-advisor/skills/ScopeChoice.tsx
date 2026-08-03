/**
 * ScopeChoice — where an install lands: this project, or the whole machine.
 *
 * It sits beside the install actions rather than at the top of the section: it
 * is a property of the install you are about to make, not a mode the panel is
 * in. Both install paths in Browse — a catalog row and the source band — read
 * this one control, so there is never a second, disagreeing scope on screen.
 */
import type { SkillsCliScope } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';

const SCOPES: { value: SkillsCliScope; label: string }[] = [
  { value: 'project', label: 'Project' },
  { value: 'global', label: 'Global' },
];

interface ScopeChoiceProps {
  value: SkillsCliScope;
  disabled?: boolean;
  onChange: (scope: SkillsCliScope) => void;
}

export function ScopeChoice({ value, disabled = false, onChange }: ScopeChoiceProps) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="text-caption text-muted-foreground">Install to</span>
      <div
        data-testid="skills-browse-scope"
        className="flex h-[24px] items-center rounded-md border-[0.5px] bg-muted p-[2px]"
      >
        {SCOPES.map((scope) => (
          <button
            key={scope.value}
            type="button"
            data-testid={`skills-browse-scope-${scope.value}`}
            aria-pressed={value === scope.value}
            disabled={disabled}
            onClick={() => onChange(scope.value)}
            className={cn(
              'h-full rounded-[5px] px-2 text-caption font-medium transition-colors',
              'disabled:pointer-events-none disabled:opacity-[0.45]',
              value === scope.value
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {scope.label}
          </button>
        ))}
      </div>
    </div>
  );
}
