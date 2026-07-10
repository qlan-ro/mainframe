import { ChevronRight, Code2, Eye, FileText, GitCompare, Terminal } from 'lucide-react';
import type { SurfaceId } from '@/store/layout';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { MenuDivider, MenuLabel } from '@/components/ui/menu';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useLaunchActions } from '@/features/run/use-launch-actions';
import { useRecentFiles } from '@/features/files/use-recent-files';

interface RowProps {
  testid: string;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  chevron?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}

function PickerRow({ testid, icon, label, hint, chevron, onClick, disabled, title }: RowProps) {
  return (
    <button
      data-testid={testid}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex w-full cursor-pointer items-center gap-[9px] rounded-[8px] border-none bg-transparent px-[12px] py-[8px] text-left text-label text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon}
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
      {hint && <span className="flex-shrink-0 font-mono text-micro text-mf-text-4">{hint}</span>}
      {chevron && <ChevronRight size={10} className="flex-shrink-0 text-mf-text-4" />}
    </button>
  );
}

/** Files-surface picker content: open-file / view-changes + a Recent (changed files) section. */
function FilesPickerContent() {
  const { projectId, chatId } = useActiveIdentity();
  const port = useDaemonPort();
  const recent = useRecentFiles(port, projectId ?? undefined, chatId ?? undefined, 3);
  return (
    <>
      <PickerRow
        testid="files-picker-open-file"
        icon={<Code2 size={14} className="flex-shrink-0 text-mf-accent-violet" />}
        label="Open file…"
        chevron
        onClick={() => emitSurfaceIntent({ type: 'open-file-picker' })}
      />
      <PickerRow
        testid="files-picker-view-changes"
        icon={<GitCompare size={14} className="flex-shrink-0 text-mf-accent-amber" />}
        label="View changes…"
        chevron
        onClick={() => emitSurfaceIntent({ type: 'inspector-tab', tab: 'changes' })}
      />
      {recent.length > 0 && (
        <>
          <MenuDivider />
          <MenuLabel>Recent</MenuLabel>
          {recent.map((f) => (
            <PickerRow
              key={f.path}
              testid={`files-picker-recent-${f.path}`}
              icon={<FileText size={14} className="flex-shrink-0 text-mf-text-3" />}
              label={f.path}
              onClick={() => emitSurfaceIntent({ type: 'open-file', path: f.path })}
            />
          ))}
        </>
      )}
    </>
  );
}

/** Run-surface picker content: a New-terminal row + the launch-config list. */
function RunPickerContent() {
  const { projectId, chatId } = useActiveIdentity();
  const port = useDaemonPort();
  const { configs, handleLaunch } = useLaunchActions(port, projectId ?? undefined, chatId ?? undefined);
  return (
    <>
      <PickerRow
        testid="run-picker-new-terminal"
        icon={<Terminal size={14} className="flex-shrink-0 text-mf-term-cyan" />}
        label="New terminal"
        hint="zsh"
        onClick={() => emitSurfaceIntent({ type: 'new-terminal' })}
      />
      <MenuDivider />
      <MenuLabel>Launch configuration</MenuLabel>
      {configs.map((cfg) => (
        <PickerRow
          key={cfg.name}
          testid={`run-picker-launch-${cfg.name}`}
          icon={
            cfg.preview ? (
              <Eye size={14} className="flex-shrink-0 text-mf-surface-run" />
            ) : (
              <Terminal size={14} className="flex-shrink-0 text-mf-term-cyan" />
            )
          }
          label={cfg.name}
          hint={cfg.preview ? 'preview' : 'process'}
          onClick={() => handleLaunch(cfg)}
        />
      ))}
    </>
  );
}

interface Props {
  surface: Exclude<SurfaceId, 'chat'>;
}

export function SurfacePicker({ surface }: Props) {
  return (
    <div
      data-testid={`${surface}-surface-picker`}
      className="flex flex-1 items-center justify-center bg-background p-[16px]"
    >
      <div className="w-[300px] overflow-hidden rounded-[13px] border-[0.5px] border-border bg-background shadow-[var(--mf-shadow-picker)]">
        <div className="mf-thin-scrollbar max-h-[300px] overflow-y-auto p-[4px]">
          {surface === 'files' ? <FilesPickerContent /> : <RunPickerContent />}
        </div>
        <div className="[border-top:0.5px_solid_var(--border)] px-3.5 py-[7px] font-mono text-micro text-mf-text-4">
          {surface === 'files' ? 'opens route here automatically' : 'spawns a running surface'}
        </div>
      </div>
    </div>
  );
}
