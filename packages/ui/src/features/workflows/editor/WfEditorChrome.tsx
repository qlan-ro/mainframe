/**
 * WfEditorChrome — WorkflowEditor's mode toggle bar + validation footer.
 *
 * Extracted from WorkflowEditor.tsx to keep it under the file-size limit.
 * Purely presentational; all state lives in WorkflowEditor.
 */
import { SlidersHorizontal, Columns2, Code, Check, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export type EditorMode = 'builder' | 'split' | 'yaml';

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ message: string }>;
}

// ── Mode toggle bar ───────────────────────────────────────────────────────────

const MODES: Array<{ id: EditorMode; label: string; Icon: typeof SlidersHorizontal }> = [
  { id: 'builder', label: 'Builder', Icon: SlidersHorizontal },
  { id: 'split', label: 'Split', Icon: Columns2 },
  { id: 'yaml', label: 'YAML', Icon: Code },
];

export function ModeToggle({ mode, setMode }: { mode: EditorMode; setMode: (m: EditorMode) => void }) {
  return (
    <div className="inline-flex gap-0.5 rounded-md bg-muted p-0.5">
      {MODES.map(({ id, label, Icon }) => {
        const on = mode === id;
        return (
          <button
            key={id}
            data-testid={`workflows-editor-mode-${id}`}
            type="button"
            onClick={() => setMode(id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-label font-medium',
              on ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-mf-text-3 hover:text-foreground',
            )}
          >
            <Icon size={12} className={on ? 'text-primary' : 'text-mf-text-3'} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Validation footer ─────────────────────────────────────────────────────────

export function ValidationFooter({
  validation,
  validationError,
  isNew,
}: {
  validation: ValidationResult | null;
  validationError: string | null;
  isNew: boolean;
}) {
  // The validate request itself failed (network error, or the daemon rejected
  // the request outright, e.g. HTTP 400 for a malformed document) — surface
  // it instead of hanging on "Validating…" forever (no silent catches).
  if (validationError) {
    return (
      <div className="flex min-h-[40px] flex-shrink-0 items-center gap-2.5 border-t border-border bg-mf-content2 px-[16px] py-2">
        <span
          data-testid="workflows-editor-validation-error"
          className="inline-flex items-center gap-1.5 text-label font-semibold text-destructive"
        >
          <TriangleAlert size={14} aria-hidden />
          {validationError}
        </span>
      </div>
    );
  }
  if (!validation) {
    return (
      <div className="flex min-h-[40px] flex-shrink-0 items-center gap-2.5 border-t border-border bg-mf-content2 px-[16px] py-2">
        <span className="text-caption text-muted-foreground">Validating…</span>
      </div>
    );
  }
  const { valid, errors } = validation;
  return (
    <div className="flex min-h-[40px] flex-shrink-0 items-center gap-2.5 border-t border-border bg-mf-content2 px-[16px] py-2">
      {valid ? (
        <span className="inline-flex items-center gap-1.5 text-label font-semibold text-mf-success">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-mf-success">
            <Check size={10} className="text-white" aria-hidden />
          </span>
          Valid · ready to {isNew ? 'create' : 'save'}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-label font-semibold text-destructive">
          <TriangleAlert size={14} aria-hidden />
          {errors.length} {errors.length === 1 ? 'issue' : 'issues'} to fix
        </span>
      )}
      {errors.length > 0 && (
        <>
          <div className="mx-1 h-4 w-px bg-border" />
          <div className="flex flex-1 items-center gap-3.5 overflow-x-auto">
            {errors.map((err, i) => (
              <span key={i} className="inline-flex flex-shrink-0 items-center gap-1.5 text-caption text-destructive">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden />
                {err.message}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
