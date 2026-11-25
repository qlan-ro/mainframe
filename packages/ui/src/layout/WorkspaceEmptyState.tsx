/**
 * WorkspaceEmptyState — what the workspace offers while it has no tabs (W5): a
 * file, a terminal, a URL, and the launch configurations.
 *
 * data-testid:
 *   workspace-empty-state              — the list
 *   workspace-picker-open-file         — Open file…
 *   workspace-picker-new-terminal      — New terminal
 *   workspace-picker-open-url          — Open URL… (swaps in the inline entry)
 *   workspace-picker-launch-<config>   — a launch configuration
 */
import { useState, type ReactNode } from 'react';
import { Eye, FileText, Globe, Terminal } from 'lucide-react';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { chordHint } from '@/features/shortcuts/chord-hint';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useLaunchActions } from '@/features/run/use-launch-actions';
import { WorkspaceUrlEntry } from './WorkspaceUrlEntry';

interface RowProps {
  testid: string;
  icon: ReactNode;
  label: string;
  hint?: string | null;
  onClick: () => void;
}

function PickerRow({ testid, icon, label, hint, onClick }: RowProps) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      className="flex h-8 w-full shrink-0 items-center gap-2.5 rounded-md px-2 text-left text-body text-ink-secondary hover:bg-sidebar-accent hover:text-foreground focus-visible:focus-line-inset [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 font-mono text-caption/[1.45] text-muted-foreground">{hint}</span>}
    </button>
  );
}

export function WorkspaceEmptyState() {
  const [urlEntryOpen, setUrlEntryOpen] = useState(false);
  const { projectId, chatId } = useActiveIdentity();
  const port = useDaemonPort();
  const { configs, handleLaunch } = useLaunchActions(port, projectId ?? undefined, chatId ?? undefined);
  return (
    <div className="flex flex-1 items-center justify-center overflow-hidden p-6">
      {/* max-h-full: in a short window the list scrolls rather than clip top and bottom against the centering. */}
      <div data-testid="workspace-empty-state" className="flex max-h-full w-[min(300px,100%)] flex-col overflow-y-auto">
        <h3 className="mb-2 ml-2 shrink-0 text-body font-semibold">Open in the workspace</h3>
        <PickerRow
          testid="workspace-picker-open-file"
          icon={<FileText />}
          label="Open file…"
          onClick={() => emitSurfaceIntent({ type: 'open-file-picker' })}
        />
        <PickerRow
          testid="workspace-picker-new-terminal"
          icon={<Terminal />}
          label="New terminal"
          hint={chordHint('workspace.new-terminal')}
          onClick={() => emitSurfaceIntent({ type: 'new-terminal' })}
        />
        {urlEntryOpen ? (
          <div className="flex shrink-0 px-2 py-1">
            <WorkspaceUrlEntry onDone={() => setUrlEntryOpen(false)} />
          </div>
        ) : (
          <PickerRow
            testid="workspace-picker-open-url"
            icon={<Globe />}
            label="Open URL…"
            hint={chordHint('workspace.new-url-tab')}
            onClick={() => setUrlEntryOpen(true)}
          />
        )}
        {configs.map((cfg) => (
          <PickerRow
            key={cfg.name}
            testid={`workspace-picker-launch-${cfg.name}`}
            icon={cfg.preview ? <Eye /> : <Terminal />}
            label={cfg.name}
            hint={cfg.preview ? 'preview' : 'process'}
            onClick={() => handleLaunch(cfg)}
          />
        ))}
      </div>
    </div>
  );
}
