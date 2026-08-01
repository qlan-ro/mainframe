/**
 * InstallBand — source field, scope segment, and Install button, with the
 * skill picker underneath.
 *
 * The probe runs on blur and on Enter, never on keystroke: it spawns a CLI
 * process, so a debounce would still fire on every pause in typing. The source
 * is validated against the daemon's own rules first, so a rejected source
 * never reaches a process.
 */
import { useState } from 'react';
import type { SkillsCliScope } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SkillPicker } from './SkillPicker';
import { useSkillsCliStore } from './use-skills-cli-store';
import { validateSkillsSource } from './validate-source';

const SCOPES: { value: SkillsCliScope; label: string }[] = [
  { value: 'project', label: 'Project' },
  { value: 'global', label: 'Global' },
];

interface InstallBandProps {
  projectId: string;
  adapterId?: string;
}

export function InstallBand({ projectId, adapterId }: InstallBandProps) {
  const [source, setSource] = useState('');
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [scope, setScope] = useState<SkillsCliScope>('project');
  const [selected, setSelected] = useState<string[]>([]);
  const [manualName, setManualName] = useState('');

  const probing = useSkillsCliStore((s) => s.probing);
  const probe = useSkillsCliStore((s) => s.probe);
  const probeError = useSkillsCliStore((s) => s.probeError);
  const installing = useSkillsCliStore((s) => s.installing);
  const runProbe = useSkillsCliStore((s) => s.runProbe);
  const install = useSkillsCliStore((s) => s.install);

  const names = probe?.status === 'unparseable' ? [manualName.trim()].filter(Boolean) : selected;
  const canInstall = !installing && !probing && sourceError === null && source.trim().length > 0 && names.length > 0;

  function editSource(value: string) {
    setSource(value);
    setSourceError(null);
    setSelected([]);
    setManualName('');
  }

  function probeSource() {
    const trimmed = source.trim();
    if (trimmed.length === 0) return;
    const invalid = validateSkillsSource(trimmed);
    if (invalid) {
      setSourceError(invalid);
      return;
    }
    setSourceError(null);
    void runProbe(projectId, trimmed, adapterId);
  }

  function toggle(name: string) {
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  }

  async function submit() {
    const ok = await install(projectId, source.trim(), names, scope, adapterId);
    if (!ok) return;
    setSource('');
    setSelected([]);
    setManualName('');
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          data-testid="skills-section-source"
          className="min-w-0 flex-1 font-mono text-label"
          value={source}
          disabled={installing}
          placeholder="owner/repo"
          aria-label="Skill source"
          onChange={(e) => editSource(e.target.value)}
          onBlur={probeSource}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            probeSource();
          }}
        />
        <div className="flex shrink-0 items-center gap-0.5 rounded-[6px] bg-muted p-0.5">
          {SCOPES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              data-testid={`skills-section-scope-${value}`}
              aria-pressed={scope === value}
              disabled={installing}
              onClick={() => setScope(value)}
              className={cn(
                'h-6 rounded-[5px] px-2 text-caption font-medium transition-colors',
                'disabled:pointer-events-none disabled:opacity-[0.45]',
                scope === value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          data-testid="skills-section-install"
          disabled={!canInstall}
          onClick={() => void submit()}
        >
          Install
        </Button>
      </div>

      {sourceError ? (
        <p data-testid="skills-section-source-error" className="text-label text-destructive">
          {sourceError}
        </p>
      ) : null}

      <SkillPicker
        probing={probing}
        probe={probe}
        probeError={probeError}
        selected={selected}
        onToggle={toggle}
        manualName={manualName}
        onManualNameChange={setManualName}
        disabled={installing}
      />
    </div>
  );
}
