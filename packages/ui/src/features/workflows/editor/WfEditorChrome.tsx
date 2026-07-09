/**
 * WfEditorChrome — WorkflowEditor's validation footer.
 *
 * Extracted from WorkflowEditor.tsx to keep it under the file-size limit.
 * Purely presentational; all state lives in WorkflowEditor. The mode toggle
 * that used to live here was dropped in Task 21 — the builder and the
 * read-only YAML pane both render at once now, so there's no mode to pick.
 */
import { Check, TriangleAlert } from 'lucide-react';

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ message: string }>;
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
