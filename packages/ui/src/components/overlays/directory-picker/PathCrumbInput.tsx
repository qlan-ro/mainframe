/**
 * PathCrumbInput — the DirectoryPickerModal's editable path crumb.
 *
 * Replaces the read-only `~` crumb with a type/paste-able input: entering an
 * absolute path and pressing Enter re-seeds the tree there (via `onNavigate`),
 * which is how the picker reaches roots outside `~`. Escape reverts to the
 * current root. Styled to read like the original mono crumb row.
 */
import { useEffect, useState } from 'react';
import { FolderIcon } from 'lucide-react';

interface PathCrumbInputProps {
  /** The current browse root — the input resets to this on nav / Escape. */
  value: string;
  onNavigate: (path: string) => void;
}

export function PathCrumbInput({ value, onNavigate }: PathCrumbInputProps) {
  const [draft, setDraft] = useState(value);

  // Re-sync when navigation changes the root out from under the input.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3.5 py-[7px]">
      <FolderIcon className="size-[12px] shrink-0 text-mf-text-4" fill="currentColor" />
      <input
        type="text"
        data-testid="directory-picker-path-input"
        aria-label="Folder path"
        spellCheck={false}
        autoComplete="off"
        value={draft}
        placeholder="Type or paste a path…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onNavigate(draft);
          } else if (e.key === 'Escape' && draft !== value) {
            // Revert without closing the modal.
            e.preventDefault();
            e.stopPropagation();
            setDraft(value);
          }
        }}
        className="w-full bg-transparent font-mono text-caption text-mf-text-3 placeholder:text-mf-text-4 focus:text-foreground focus:outline-none"
      />
    </div>
  );
}
