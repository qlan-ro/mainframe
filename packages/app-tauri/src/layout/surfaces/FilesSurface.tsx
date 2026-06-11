/**
 * FilesSurface — the Files typed surface.
 *
 * Renders:
 *  1. FilesTabStrip — the tab strip at the top (with per-tab controls).
 *  2. Active tab body — EditorTab / DiffTab / SkillEditorTab / ViewerRouter.
 *
 * When no tab is open the empty-state SurfacePicker is shown (existing stub).
 *
 * data-testid: "files-surface" on root.
 */
import { useTabsStore } from '@/store/tabs';
import { FilesTabStrip } from '../FilesTabStrip';
import { SurfacePicker } from '../SurfacePicker';
import { EditorTabBody } from './EditorTabBody';

export function FilesSurface() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div data-testid="files-surface" className="flex h-full flex-col">
      <FilesTabStrip />

      {activeTab ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <EditorTabBody tab={activeTab} />
        </div>
      ) : (
        <SurfacePicker surface="files" />
      )}
    </div>
  );
}
