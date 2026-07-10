/**
 * Status banners shared by every EditorTab code path (plain code AND the
 * markdown Preview/Source tab). Hoisted out of the code-only branch so a
 * dirty-buffer disk conflict on a markdown file is never silently swallowed.
 */

export function ReadOnlyBanner({ external }: { external: boolean }) {
  return (
    <div
      data-testid="editor-tab-readonly"
      className="flex-shrink-0 bg-mf-tab-bar px-3 py-0.5 text-caption text-mf-text-3"
    >
      {external ? 'Read-only — outside the project' : 'Read-only'}
    </div>
  );
}

export function SaveErrorBanner({ message }: { message: string }) {
  return (
    <div
      data-testid="editor-tab-save-error"
      className="flex-shrink-0 bg-mf-destructive-tint px-3 py-1 text-caption text-destructive"
    >
      Save failed: {message}
    </div>
  );
}

export function DiskConflictBanner({ onReload, onKeepMine }: { onReload: () => void; onKeepMine: () => void }) {
  return (
    <div
      data-testid="editor-tab-disk-conflict"
      className="flex flex-shrink-0 items-center gap-2 bg-mf-warning-tint px-3 py-1 text-caption text-mf-warning"
    >
      <span className="flex-1">File changed on disk</span>
      <button data-testid="editor-tab-reload" onClick={onReload} className="rounded px-2 py-0.5 hover:opacity-80">
        Reload
      </button>
      <button data-testid="editor-tab-keep-mine" onClick={onKeepMine} className="rounded px-2 py-0.5 hover:opacity-80">
        Keep mine
      </button>
    </div>
  );
}
