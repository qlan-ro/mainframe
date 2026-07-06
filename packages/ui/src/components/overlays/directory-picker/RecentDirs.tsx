/**
 * RecentDirs — the "Recent" section shown at the top of the DirectoryPicker
 * tree when landing at the home root. Rows are recently-picked directories
 * (store/recent-directories); clicking one navigates the tree there.
 */
import { FolderIcon } from 'lucide-react';

interface RecentDirsProps {
  paths: string[];
  onPick: (path: string) => void;
}

/** Splits an absolute (or ~-rooted) path into its basename and parent for display. */
function splitPath(path: string): { name: string; parent: string } {
  const segments = path.split('/').filter(Boolean);
  const name = segments.length > 0 ? segments[segments.length - 1]! : path;
  const parent = path.slice(0, path.length - name.length).replace(/\/+$/, '') || '/';
  return { name, parent };
}

export function RecentDirs({ paths, onPick }: RecentDirsProps) {
  if (paths.length === 0) return null;

  return (
    <div data-testid="directory-picker-recent" className="border-b border-border pb-1.5 pt-1">
      <p className="px-3.5 py-1 text-micro font-semibold uppercase tracking-wide text-mf-text-4">Recent</p>
      {paths.map((path) => {
        const { name, parent } = splitPath(path);
        return (
          <button
            key={path}
            type="button"
            data-testid={`directory-picker-recent-${path}`}
            onClick={() => onPick(path)}
            className="group flex w-full items-center gap-1.5 px-3.5 py-[5px] text-left text-body hover:bg-accent hover:text-accent-foreground"
          >
            <FolderIcon className="size-[14px] shrink-0 text-primary" fill="currentColor" />
            <span className="shrink-0 truncate font-medium text-muted-foreground group-hover:text-accent-foreground">
              {name}
            </span>
            <span className="truncate font-mono text-caption text-mf-text-4">{parent}</span>
          </button>
        );
      })}
    </div>
  );
}
