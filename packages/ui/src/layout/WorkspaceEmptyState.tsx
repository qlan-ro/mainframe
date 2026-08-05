/**
 * WorkspaceEmptyState — the inline card the workspace surface shows while it has
 * no tabs. Not a menu: it has no trigger and is always visible, so it stays a
 * card of rows (open a file, view changes, a recent-changes list, a URL, a
 * terminal, and the project's launch configs).
 *
 * data-testid:
 *   workspace-empty-state              — the card
 *   workspace-picker-open-file         — Open file…
 *   workspace-picker-view-changes      — View changes…
 *   workspace-picker-recent-<path>     — a recently-changed file
 *   workspace-picker-open-url          — Open URL… (swaps in the inline entry)
 *   workspace-picker-new-terminal      — New terminal
 *   workspace-picker-launch-<config>   — a launch configuration
 */
import { useState } from 'react';
import { ChevronRight, Code2, Eye, FileText, GitCompare, Globe, Terminal } from 'lucide-react';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { MenuDivider, MenuLabel } from '@/components/ui/menu';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useLaunchActions } from '@/features/run/use-launch-actions';
import { useRecentFiles } from '@/features/files/use-recent-files';
import { WorkspaceUrlEntry } from './WorkspaceUrlEntry';

interface RowProps {
  testid: string;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  chevron?: boolean;
  onClick?: () => void;
}

function PickerRow({ testid, icon, label, hint, chevron, onClick }: RowProps) {
  return (
    <button
      data-testid={testid}
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-[9px] rounded-[8px] border-none bg-transparent px-[12px] py-[8px] text-left text-label text-foreground hover:bg-accent"
    >
      {icon}
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
      {hint && <span className="flex-shrink-0 font-mono text-caption text-muted-foreground">{hint}</span>}
      {chevron && <ChevronRight size={12} className="flex-shrink-0 text-mf-text-3" />}
    </button>
  );
}

/** Open-a-file rows + the recently-changed files of the active session. */
function FileRows() {
  const { projectId, chatId } = useActiveIdentity();
  const port = useDaemonPort();
  const recent = useRecentFiles(port, projectId ?? undefined, chatId ?? undefined, 3);
  return (
    <>
      <PickerRow
        testid="workspace-picker-open-file"
        icon={<Code2 size={14} className="flex-shrink-0 text-mf-accent-violet" />}
        label="Open file…"
        chevron
        onClick={() => emitSurfaceIntent({ type: 'open-file-picker' })}
      />
      <PickerRow
        testid="workspace-picker-view-changes"
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
              testid={`workspace-picker-recent-${f.path}`}
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

/** URL + terminal rows, then the project's launch configurations. */
function RunRows() {
  const [urlEntryOpen, setUrlEntryOpen] = useState(false);
  const { projectId, chatId } = useActiveIdentity();
  const port = useDaemonPort();
  const { configs, handleLaunch } = useLaunchActions(port, projectId ?? undefined, chatId ?? undefined);
  return (
    <>
      {urlEntryOpen ? (
        <div className="flex px-[12px] py-[8px]">
          <WorkspaceUrlEntry onDone={() => setUrlEntryOpen(false)} />
        </div>
      ) : (
        <PickerRow
          testid="workspace-picker-open-url"
          icon={<Globe size={14} className="flex-shrink-0 text-mf-surface-run" />}
          label="Open URL…"
          onClick={() => setUrlEntryOpen(true)}
        />
      )}
      <PickerRow
        testid="workspace-picker-new-terminal"
        icon={<Terminal size={14} className="flex-shrink-0 text-mf-term-cyan" />}
        label="New terminal"
        hint="zsh"
        onClick={() => emitSurfaceIntent({ type: 'new-terminal' })}
      />
      <MenuDivider />
      <MenuLabel>Launch configuration</MenuLabel>
      {configs.length === 0 ? (
        <div className="px-[12px] py-[8px] text-caption text-muted-foreground">No launch configs found.</div>
      ) : (
        configs.map((cfg) => (
          <PickerRow
            key={cfg.name}
            testid={`workspace-picker-launch-${cfg.name}`}
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
        ))
      )}
    </>
  );
}

export function WorkspaceEmptyState() {
  return (
    <div data-testid="workspace-empty-state" className="flex flex-1 items-center justify-center bg-background p-[16px]">
      <div className="w-[300px] overflow-hidden rounded-[13px] border-[0.5px] border-border bg-background shadow-[var(--mf-shadow-picker)]">
        <div className="max-h-[300px] overflow-y-auto p-[4px]">
          <FileRows />
          <MenuDivider />
          <RunRows />
        </div>
        <div className="[border-top:0.5px_solid_var(--border)] px-3.5 py-[7px] font-mono text-caption text-muted-foreground">
          files, terminals, and previews share this surface
        </div>
      </div>
    </div>
  );
}
