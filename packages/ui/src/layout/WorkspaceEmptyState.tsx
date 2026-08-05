/**
 * WorkspaceEmptyState — the inline card the workspace shows while it has no tabs.
 *
 * Not a menu: it has no trigger and is always visible, so it stays a Card of
 * rows rather than a DropdownMenu. The rows are ghost Buttons, which is what a
 * full-width action row is in v2 — hand-rolled row markup would just re-declare
 * the button's own hover, focus ring and disabled handling.
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
import { Button } from '@v2/components/ui/button';
import { Card } from '@v2/components/ui/card';
import { Separator } from '@v2/components/ui/separator';
import { emitSurfaceIntent } from '@/store/surface-intents';
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
    <Button
      data-testid={testid}
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="w-full justify-start gap-2 font-normal"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {hint && <span className="shrink-0 font-mono text-xs text-muted-foreground">{hint}</span>}
      {chevron && <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
    </Button>
  );
}

/** A group label inside the card — the same eyebrow the add-menu uses for its groups. */
function RowLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">{children}</div>;
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
        icon={<Code2 className="size-3.5 text-muted-foreground" />}
        label="Open file…"
        chevron
        onClick={() => emitSurfaceIntent({ type: 'open-file-picker' })}
      />
      <PickerRow
        testid="workspace-picker-view-changes"
        icon={<GitCompare className="size-3.5 text-muted-foreground" />}
        label="View changes…"
        chevron
        onClick={() => emitSurfaceIntent({ type: 'inspector-tab', tab: 'changes' })}
      />
      {recent.length > 0 && (
        <>
          <RowLabel>Recent</RowLabel>
          {recent.map((f) => (
            <PickerRow
              key={f.path}
              testid={`workspace-picker-recent-${f.path}`}
              icon={<FileText className="size-3.5 text-muted-foreground" />}
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
        <div className="flex px-2 py-1">
          <WorkspaceUrlEntry onDone={() => setUrlEntryOpen(false)} />
        </div>
      ) : (
        <PickerRow
          testid="workspace-picker-open-url"
          icon={<Globe className="size-3.5 text-muted-foreground" />}
          label="Open URL…"
          onClick={() => setUrlEntryOpen(true)}
        />
      )}
      <PickerRow
        testid="workspace-picker-new-terminal"
        icon={<Terminal className="size-3.5 text-muted-foreground" />}
        label="New terminal"
        hint="zsh"
        onClick={() => emitSurfaceIntent({ type: 'new-terminal' })}
      />
      <RowLabel>Launch configuration</RowLabel>
      {configs.length === 0 ? (
        <div className="px-2 py-2 text-xs text-muted-foreground">No launch configs found.</div>
      ) : (
        configs.map((cfg) => (
          <PickerRow
            key={cfg.name}
            testid={`workspace-picker-launch-${cfg.name}`}
            icon={
              cfg.preview ? (
                <Eye className="size-3.5 text-muted-foreground" />
              ) : (
                <Terminal className="size-3.5 text-muted-foreground" />
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
    <div className="flex flex-1 items-center justify-center overflow-hidden p-4">
      <Card data-testid="workspace-empty-state" className="w-72 gap-0 overflow-hidden py-0">
        <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto p-1">
          <FileRows />
          <Separator className="my-1" />
          <RunRows />
        </div>
        <div className="border-t border-border px-3 py-1.5 font-mono text-xs text-muted-foreground">
          files, terminals, and previews share this surface
        </div>
      </Card>
    </div>
  );
}
