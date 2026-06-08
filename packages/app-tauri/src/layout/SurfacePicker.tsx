import { ChevronRight, FileText, GitCompare, Terminal } from 'lucide-react';
import type { SurfaceId } from '@/store/layout';

interface RowProps {
  testid: string;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  chevron?: boolean;
}

function PickerRow({ testid, icon, label, hint, chevron }: RowProps) {
  return (
    <button
      data-testid={testid}
      type="button"
      className="flex w-full cursor-pointer items-center gap-[9px] rounded-lg border-none bg-transparent px-3 py-2 text-left text-caption text-foreground hover:bg-accent"
    >
      {icon}
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
      {hint && <span className="flex-shrink-0 font-mono text-micro text-mf-text-4">{hint}</span>}
      {chevron && <ChevronRight size={10} className="flex-shrink-0 text-mf-text-4" />}
    </button>
  );
}

interface Props {
  surface: Exclude<SurfaceId, 'chat'>;
}

export function SurfacePicker({ surface }: Props) {
  return (
    <div
      data-testid={`${surface}-surface-picker`}
      className="flex flex-1 items-center justify-center bg-background p-4"
    >
      <div className="w-[300px] overflow-hidden rounded-[13px] border-[0.5px] border-border bg-background shadow-[var(--mf-shadow-picker)]">
        <div className="p-1">
          {surface === 'files' ? (
            <>
              <PickerRow
                testid="files-picker-open-file"
                icon={<FileText size={14} className="flex-shrink-0 text-mf-surface-files" />}
                label="Open file…"
                chevron
              />
              <PickerRow
                testid="files-picker-view-changes"
                icon={<GitCompare size={14} className="flex-shrink-0 text-mf-surface-files" />}
                label="View changes…"
                chevron
              />
            </>
          ) : (
            <PickerRow
              testid="run-picker-new-terminal"
              icon={<Terminal size={14} className="flex-shrink-0 text-mf-surface-run" />}
              label="New terminal"
              hint="zsh"
            />
          )}
        </div>
        <div className="border-t border-border px-3.5 py-[7px] font-mono text-micro text-mf-text-4">
          {surface === 'files' ? 'opens route here automatically' : 'spawns a running surface'}
        </div>
      </div>
    </div>
  );
}
