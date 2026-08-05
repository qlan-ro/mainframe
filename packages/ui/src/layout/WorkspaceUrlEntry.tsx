/**
 * WorkspaceUrlEntry — the inline "open a URL" field (#281), shared by the Run tab
 * strip's `+` menu and the empty-state picker.
 *
 * Inline rather than a dialog: the strip is already the anchor, and a modal for
 * one text field is heavier than the action. It only emits an intent — the
 * subscriber owns tab creation — so it reads no layout state.
 *
 * data-testid:
 *   workspace-url-entry        — the field wrapper
 *   workspace-url-entry-input  — the input
 */
import { useState } from 'react';
import { Globe } from 'lucide-react';
import { normalizePreviewUrl } from '@/features/preview/normalize-url';
import { emitSurfaceIntent } from '@/store/surface-intents';

interface WorkspaceUrlEntryProps {
  /** Target pane; omitted from the empty-state picker, which has no pane yet. */
  paneId?: string;
  /** Called once the entry is finished with — on commit, Escape, or blur. */
  onDone: () => void;
}

export function WorkspaceUrlEntry({ paneId, onDone }: WorkspaceUrlEntryProps) {
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);

  function commit() {
    const url = normalizePreviewUrl(draft);
    if (!url) {
      setInvalid(true);
      return;
    }
    emitSurfaceIntent({ type: 'open-url-tab', url, paneId });
    onDone();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onDone();
    }
  }

  return (
    <div
      data-testid="workspace-url-entry"
      className="flex h-[24px] min-w-0 flex-1 items-center gap-1 rounded-md border-[0.5px] border-border bg-card pl-1.5 pr-1"
    >
      <Globe size={12} className="flex-shrink-0 text-mf-text-3" aria-hidden />
      <input
        data-testid="workspace-url-entry-input"
        autoFocus
        value={draft}
        spellCheck={false}
        autoComplete="off"
        aria-label="Open a URL"
        aria-invalid={invalid}
        placeholder="localhost:3000"
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={handleKeyDown}
        onBlur={onDone}
        className={`min-w-0 flex-1 bg-transparent px-[4px] font-mono text-body outline-none placeholder:text-mf-text-4 ${
          invalid ? 'rounded-sm text-destructive ring-1 ring-destructive' : 'text-foreground'
        }`}
      />
    </div>
  );
}
