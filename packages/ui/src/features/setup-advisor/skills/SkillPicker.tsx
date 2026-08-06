/**
 * SkillPicker — what the install band offers between typing a source and
 * pressing Install: a spinner while the probe runs, the probed names as
 * toggles, an explicit "nothing here" line, or — when the probe fails or its
 * output can't be parsed — a manual skill-name field. The degraded path never
 * prints a command for the user to run by hand; the CLI still does the work.
 */
import { Check, Loader2 } from 'lucide-react';
import type { SkillsCliProbe } from '@qlan-ro/mainframe-types';
import { Input } from '@v2/components/ui/input';
import { cn } from '@/lib/utils';

interface SkillPickerProps {
  probing: boolean;
  probe: SkillsCliProbe | null;
  probeError: string | null;
  selected: string[];
  onToggle: (name: string) => void;
  manualName: string;
  onManualNameChange: (name: string) => void;
  disabled: boolean;
}

export function SkillPicker({
  probing,
  probe,
  probeError,
  selected,
  onToggle,
  manualName,
  onManualNameChange,
  disabled,
}: SkillPickerProps) {
  if (probing) {
    return (
      <div
        data-testid="skills-section-skill-picker-spinner"
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground"
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Reading the source
      </div>
    );
  }

  if (!probe) return null;

  if (probe.status === 'unparseable') {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">
          {probeError ?? "Mainframe couldn't read the skills in this source."} Name the skill to install.
        </p>
        <Input
          data-testid="skills-section-skill-name-input"
          value={manualName}
          disabled={disabled}
          placeholder="skill-name"
          aria-label="Skill name"
          onChange={(e) => onManualNameChange(e.target.value)}
        />
      </div>
    );
  }

  if (probe.skills.length === 0) {
    return (
      <p data-testid="skills-section-skill-picker-empty" className="px-2 py-1.5 text-xs text-muted-foreground">
        This source has no skills.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {probe.skills.map((skill) => {
        const isSelected = selected.includes(skill.name);
        return (
          <button
            key={skill.name}
            type="button"
            data-testid={`skills-section-skill-option-${skill.name}`}
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => onToggle(skill.name)}
            className={cn(
              'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors',
              'disabled:pointer-events-none disabled:opacity-[0.45]',
              isSelected ? 'bg-accent' : 'hover:bg-accent',
            )}
          >
            <Check className={cn('size-3.5 shrink-0', isSelected ? 'text-primary' : 'text-transparent')} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{skill.name}</span>
            {skill.description ? (
              <span className="min-w-0 flex-[2] truncate text-xs text-muted-foreground">{skill.description}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
