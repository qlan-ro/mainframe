/**
 * WfYamlPane — editable YAML textarea bound to the editor's yaml/onChange.
 * Header chip reflects the latest validation: green "Valid" or amber "N issues".
 */
import { FileText, Check, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ValidationResult {
  valid: boolean;
  errors: Array<{ message: string }>;
}

interface WfYamlPaneProps {
  yaml: string;
  onChange: (value: string) => void;
  validation: ValidationResult | null;
}

export function WfYamlPane({ yaml, onChange, validation }: WfYamlPaneProps): React.ReactElement {
  const valid = validation?.valid ?? null;
  const errorCount = validation?.errors.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-mf-code-bg">
      {/* header */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
        <FileText size={13} className="text-muted-foreground" aria-hidden />
        <span className="font-mono text-caption font-semibold text-muted-foreground">workflow.yaml</span>
        <span className="text-micro uppercase tracking-wide text-mf-text-4">canonical</span>
        <span className="flex-1" />
        {valid === true && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-mf-success-tint px-2 py-0.5 text-micro font-bold text-mf-success">
            <Check size={10} aria-hidden />
            Valid
          </span>
        )}
        {valid === false && errorCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-mf-destructive-tint px-2 py-0.5 text-micro font-bold text-destructive">
            <TriangleAlert size={10} aria-hidden />
            {errorCount} {errorCount === 1 ? 'issue' : 'issues'}
          </span>
        )}
        {valid === null && <span className="text-micro text-mf-text-4">Validating…</span>}
      </div>
      {/* editable textarea */}
      <textarea
        data-testid="workflows-editor-yaml"
        value={yaml}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className={cn(
          'flex-1 resize-none border-none bg-mf-code-bg p-[10px_14px] font-mono text-caption leading-relaxed text-mf-code-fg outline-none',
        )}
      />
    </div>
  );
}
