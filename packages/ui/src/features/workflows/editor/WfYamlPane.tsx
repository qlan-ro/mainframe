/**
 * WfYamlPane — read-only, syntax-highlighted preview of the generated YAML.
 *
 * The builder is the single source of truth (Task 21); this pane only ever
 * shows `serializeWorkflow(model)`, so it takes no `onChange` and has no
 * editable textarea. Header chip reflects the latest validation: green
 * "Valid" or amber "N issues".
 */
import { useCallback, useState } from 'react';
import { FileText, Check, TriangleAlert, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ShikiCode } from '@/lib/shiki-tokens';
import { Hint } from '@/components/ui/hint';

interface ValidationResult {
  valid: boolean;
  errors: Array<{ message: string }>;
}

interface WfYamlPaneProps {
  yaml: string;
  validation: ValidationResult | null;
  filename: string;
}

const PRE_CLASS =
  'flex-1 overflow-auto bg-mf-code-bg p-[10px_14px] font-mono text-caption leading-relaxed text-mf-code-fg';

function YamlCopyButton({ yaml }: { yaml: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(yaml).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      (err: unknown) => {
        console.warn('[WfYamlPane] clipboard write failed', err);
      },
    );
  }, [yaml]);

  return (
    <Hint label={copied ? 'Copied' : 'Copy YAML'}>
      <button
        type="button"
        data-testid="workflows-editor-yaml-copy"
        aria-label={copied ? 'Copied' : 'Copy YAML'}
        onClick={handleCopy}
        className={cn(
          'inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-sm text-mf-text-3 hover:bg-accent hover:text-foreground',
          copied && 'text-mf-success',
        )}
      >
        {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
      </button>
    </Hint>
  );
}

export function WfYamlPane({ yaml, validation, filename }: WfYamlPaneProps): React.ReactElement {
  const valid = validation?.valid ?? null;
  const errorCount = validation?.errors.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-mf-code-bg">
      {/* header */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-mf-content2 px-3 py-2">
        <FileText size={13} className="text-muted-foreground" aria-hidden />
        <span className="font-mono text-caption font-semibold text-muted-foreground">{filename}</span>
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
        <YamlCopyButton yaml={yaml} />
      </div>
      {/* read-only preview */}
      <div data-testid="workflows-editor-yaml" className="flex min-h-0 flex-1 flex-col">
        <ShikiCode code={yaml} lang="yaml" preClass={PRE_CLASS} />
      </div>
    </div>
  );
}
