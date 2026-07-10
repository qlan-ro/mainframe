import type { DiskConflict } from './use-file-watch-reload';

interface EditorBannersProps {
  readOnly: boolean;
  /** Read-only because the file lives outside the project (external endpoint). */
  external: boolean;
  saveError: string | null;
  diskConflict: DiskConflict | null;
  onReload: () => void;
  onKeepMine: () => void;
}

/** The status banner strip above the code editor: read-only, save-error, disk-conflict. */
export function EditorBanners({
  readOnly,
  external,
  saveError,
  diskConflict,
  onReload,
  onKeepMine,
}: EditorBannersProps) {
  return (
    <>
      {readOnly && (
        <div
          data-testid="editor-tab-readonly"
          className="flex-shrink-0 bg-mf-tab-bar px-3 py-0.5 text-caption text-mf-text-3"
        >
          {external ? 'Read-only — outside the project' : 'Read-only'}
        </div>
      )}
      {saveError !== null && (
        <div
          data-testid="editor-tab-save-error"
          className="flex-shrink-0 bg-mf-destructive-tint px-3 py-1 text-caption text-destructive"
        >
          Save failed: {saveError}
        </div>
      )}
      {diskConflict !== null && (
        <div
          data-testid="editor-tab-disk-conflict"
          className="flex flex-shrink-0 items-center gap-2 bg-mf-warning-tint px-3 py-1 text-caption text-mf-warning"
        >
          <span className="flex-1">File changed on disk</span>
          <button data-testid="editor-tab-reload" onClick={onReload} className="rounded px-2 py-0.5 hover:opacity-80">
            Reload
          </button>
          <button
            data-testid="editor-tab-keep-mine"
            onClick={onKeepMine}
            className="rounded px-2 py-0.5 hover:opacity-80"
          >
            Keep mine
          </button>
        </div>
      )}
    </>
  );
}
