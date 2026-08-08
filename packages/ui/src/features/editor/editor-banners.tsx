/**
 * Status banners shared by every EditorTab code path (plain code AND the
 * markdown Preview/Source tab). Hoisted out of the code-only branch so a
 * dirty-buffer disk conflict on a markdown file is never silently swallowed.
 *
 * Thin single-line strips rather than the v2 `Alert` recipe: Alert's grid +
 * `px-4 py-3` card is a block callout, and these sit in the editor's own column
 * between the header and the document.
 */
import { Button } from '@/components/ui/button';

export function ReadOnlyBanner({ external }: { external: boolean }) {
  return (
    <div data-testid="editor-tab-readonly" className="shrink-0 bg-muted px-3 py-0.5 text-xs text-muted-foreground">
      {external ? 'Read-only — outside the project' : 'Read-only'}
    </div>
  );
}

export function SaveErrorBanner({ message }: { message: string }) {
  return (
    <div data-testid="editor-tab-save-error" className="shrink-0 bg-destructive/10 px-3 py-1 text-xs text-destructive">
      Save failed: {message}
    </div>
  );
}

export function DiskConflictBanner({ onReload, onKeepMine }: { onReload: () => void; onKeepMine: () => void }) {
  return (
    <div
      data-testid="editor-tab-disk-conflict"
      className="flex shrink-0 items-center gap-2 bg-warning/10 px-3 py-1 text-xs text-foreground"
    >
      <span className="flex-1">File changed on disk</span>
      <Button data-testid="editor-tab-reload" variant="ghost" size="xs" onClick={onReload}>
        Reload
      </Button>
      <Button data-testid="editor-tab-keep-mine" variant="ghost" size="xs" onClick={onKeepMine}>
        Keep mine
      </Button>
    </div>
  );
}
