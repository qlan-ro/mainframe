/**
 * PathCrumbInput — the DirectoryPickerModal's editable path crumb.
 *
 * Replaces the read-only `~` crumb with a type/paste-able input: entering an
 * absolute path and pressing Enter re-seeds the tree there (via `onNavigate`),
 * which is how the picker reaches roots outside `~`. Escape reverts to the
 * current root. Styled to read like the original mono crumb row.
 *
 * Escape is intercepted on `document`'s CAPTURE phase (not this input's own
 * bubble-phase onKeyDown) because Radix Dialog's Escape-close listener
 * (`@radix-ui/react-use-escape-keydown`) is also registered on `document`
 * with `{ capture: true }`. Two capture-phase listeners on the same node run
 * in registration order, and React commits a child's mount effects before its
 * parent's — so as long as this component is a descendant of the Dialog (it
 * always is), registering here on mount wins the race and can
 * `stopImmediatePropagation()` before the Dialog ever sees the key. A plain
 * bubble-phase handler on the input itself can never win that race: the
 * Dialog's capture-phase listener already ran (and already closed the dialog)
 * before the event reaches the input at all.
 */
import { useEffect, useRef, useState } from 'react';
import { FolderIcon } from 'lucide-react';

interface PathCrumbInputProps {
  /** The current browse root — the input resets to this on nav / Escape. */
  value: string;
  onNavigate: (path: string) => void;
}

export function PathCrumbInput({ value, onNavigate }: PathCrumbInputProps) {
  const [draft, setDraft] = useState(value);
  // Refs so the document-capture listener (registered once, on mount) always
  // reads the latest draft/value without needing to re-register every
  // keystroke or every navigation.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const valueRef = useRef(value);
  valueRef.current = value;

  // Re-sync when navigation changes the root out from under the input.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // Beat the Dialog's capture-phase Escape-close listener (see file-level
  // comment). Only intervenes while the draft is dirty; an unedited Escape
  // falls through untouched so a second Escape closes the dialog as usual.
  useEffect(() => {
    function handleCaptureEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (draftRef.current === valueRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setDraft(valueRef.current);
    }
    document.addEventListener('keydown', handleCaptureEscape, { capture: true });
    return () => document.removeEventListener('keydown', handleCaptureEscape, { capture: true });
  }, []);

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
          }
          // Escape is handled by the document-capture listener above — it has
          // to run before Radix's own capture-phase Escape-close listener,
          // which is earlier than this bubble-phase handler could ever fire.
        }}
        className="w-full bg-transparent font-mono text-caption text-mf-text-3 placeholder:text-mf-text-4 focus:text-foreground focus:outline-none"
      />
    </div>
  );
}
