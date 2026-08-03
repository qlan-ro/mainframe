/**
 * InstallBand — source field, Install button, and the skill picker underneath:
 * the way in for a repository the registry doesn't list.
 *
 * The probe runs on blur and on Enter, never on keystroke: it spawns a CLI
 * process, so a debounce would still fire on every pause in typing. The source
 * is validated against the daemon's own rules first, so a rejected source
 * never reaches a process.
 *
 * Scope is a prop, not local state — Browse owns the one scope control, and a
 * second one here could disagree with it on screen.
 */
import { useState } from 'react';
import type { SkillsCliScope } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SkillPicker } from './SkillPicker';
import { useSkillsCliStore } from './use-skills-cli-store';
import { validateSkillsSource } from './validate-source';

interface InstallBandProps {
  projectId: string;
  scope: SkillsCliScope;
  adapterId?: string;
}

export function InstallBand({ projectId, scope, adapterId }: InstallBandProps) {
  const [source, setSource] = useState('');
  const [sourceError, setSourceError] = useState<string | null>(null);
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
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          data-testid="skills-section-source"
          className="min-w-[160px] flex-1 font-mono text-label"
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
