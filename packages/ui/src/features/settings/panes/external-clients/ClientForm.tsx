import { useState } from 'react';
import type { CreateExternalMcpClient, ExecutionMode, ExternalMcpAccess, Project } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const MODES: { id: ExecutionMode; label: string }[] = [
  { id: 'default', label: 'Interactive' },
  { id: 'acceptEdits', label: 'Auto-Accept Edits' },
  { id: 'auto', label: 'Auto' },
  { id: 'yolo', label: 'Unattended' },
];
export function modeLabel(mode: ExecutionMode) {
  return MODES.find((m) => m.id === mode)?.label ?? mode;
}

interface Props {
  projects: Project[];
  busy: boolean;
  onCreate: (input: CreateExternalMcpClient) => Promise<void>;
}

export function ClientForm({ projects, busy, onCreate }: Props) {
  const [name, setName] = useState('');
  const [access, setAccess] = useState<ExternalMcpAccess>('read');
  const [mode, setMode] = useState<ExecutionMode>('default');
  const [answerPrompts, setAnswerPrompts] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <form
      className="flex flex-col gap-4"
      data-testid="external-clients-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onCreate({
          name: name.trim(),
          projectIds: selected,
          access,
          maxPermissionMode: mode,
          answerPrompts: access === 'control' && answerPrompts,
        });
      }}
    >
      <ClientName name={name} setName={setName} busy={busy} />
      <ClientPermissions access={access} setAccess={setAccess} mode={mode} setMode={setMode} busy={busy} />
      {access === 'control' && <PromptAnswers checked={answerPrompts} setChecked={setAnswerPrompts} busy={busy} />}
      <ProjectChoices projects={projects} selected={selected} setSelected={setSelected} busy={busy} />
      <Button
        type="submit"
        className="self-start"
        disabled={busy || !name.trim() || !selected.length}
        data-testid="external-clients-add"
      >
        {busy ? 'Saving…' : 'Add client'}
      </Button>
    </form>
  );
}

interface PermissionProps {
  access: ExternalMcpAccess;
  setAccess: (v: ExternalMcpAccess) => void;
  mode: ExecutionMode;
  setMode: (v: ExecutionMode) => void;
  busy: boolean;
}
function ClientPermissions({ access, setAccess, mode, setMode, busy }: PermissionProps) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor="external-client-access">Access</Label>
        <Select
          value={access}
          onValueChange={(v) => {
            if (v === 'read' || v === 'control') setAccess(v);
          }}
          disabled={busy}
        >
          <SelectTrigger id="external-client-access" data-testid="external-clients-access">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="read">Read only</SelectItem>
            <SelectItem value="control">Control chats</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {access === 'control' && <PermissionCeiling mode={mode} setMode={setMode} busy={busy} />}
    </div>
  );
}

function ClientName({ name, setName, busy }: { name: string; setName: (v: string) => void; busy: boolean }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="external-client-name">Client name</Label>
      <Input
        id="external-client-name"
        value={name}
        maxLength={80}
        placeholder="Codex Voice"
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        data-testid="external-clients-name"
      />
    </div>
  );
}

interface ProjectProps {
  projects: Project[];
  selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  busy: boolean;
}
function ProjectChoices({ projects, selected, setSelected, busy }: ProjectProps) {
  return (
    <fieldset className="grid min-w-0 gap-2" disabled={busy}>
      <legend className="mb-2 text-sm font-medium">Projects</legend>
      {projects.length === 0 && <p className="text-sm text-muted-foreground">Add a project to Mainframe first.</p>}
      <div className="grid max-h-48 gap-1 overflow-y-auto">
        {projects.map((p) => (
          <label key={p.id} className="flex min-h-9 items-center gap-2 text-sm">
            <Checkbox
              checked={selected.includes(p.id)}
              data-testid={`external-clients-project-${p.id}`}
              onCheckedChange={(checked) =>
                setSelected((ids) => (checked === true ? [...ids, p.id] : ids.filter((id) => id !== p.id)))
              }
            />
            <span className="min-w-0 truncate" title={p.path}>
              {p.name}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PromptAnswers({
  checked,
  setChecked,
  busy,
}: {
  checked: boolean;
  setChecked: (v: boolean) => void;
  busy: boolean;
}) {
  return (
    <div className="grid gap-2">
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <Checkbox
          checked={checked}
          disabled={busy}
          data-testid="external-clients-answer-prompts"
          onCheckedChange={(value) => setChecked(value === true)}
        />
        <span>Answer prompts</span>
      </label>
      <p className="text-sm text-muted-foreground">
        Can approve or deny permission prompts once, answer questions and approve plans. Without this, prompts stay in
        Mainframe.
      </p>
    </div>
  );
}

function PermissionCeiling({ mode, setMode, busy }: Pick<PermissionProps, 'mode' | 'setMode' | 'busy'>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="external-client-mode">Maximum permission level</Label>
      <Select
        value={mode}
        onValueChange={(v) => {
          const m = MODES.find((m) => m.id === v);
          if (m) setMode(m.id);
        }}
        disabled={busy}
      >
        <SelectTrigger id="external-client-mode" data-testid="external-clients-mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODES.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-sm text-muted-foreground">Can start, message, stop and configure chats up to this level.</p>
    </div>
  );
}
