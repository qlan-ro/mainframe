/**
 * CommandPreview — A1's read-only "what will run" block (contract §6, ts153
 * had no artboard for this — form-builder idiom per the plan). All the
 * lexing lives in the already-tested pure `buildCommandPreview`; this
 * component only renders its result: literal text plus quoted `"$MF_<n>"`
 * placeholders, and a plain-language warning wherever the substitution won't
 * expand (single quotes / quoted heredoc). `cwd`/`runIn` is deliberately
 * never passed in — A1 excludes it from the preview.
 */
import { TriangleAlert } from 'lucide-react';
import type { ChipText } from '../contract';
import { buildCommandPreview } from '../domain/command-preview';

export interface CommandPreviewProps {
  script: ChipText;
  testId: string;
}

export function CommandPreview({ script, testId }: CommandPreviewProps) {
  const { text, warnings } = buildCommandPreview(script);
  return (
    <div data-testid={testId} className="flex flex-col gap-1.5">
      <span className="text-caption font-medium text-muted-foreground">What will run</span>
      <pre
        data-testid={`${testId}-text`}
        className="whitespace-pre-wrap break-words rounded-md border-[0.5px] border-border bg-muted/40 p-2.5 font-mono text-caption text-foreground"
      >
        {text}
      </pre>
      {warnings.map((warning) => (
        <span
          key={warning.index}
          data-testid={`${testId}-warning-${warning.index}`}
          className="flex items-start gap-1.5 text-caption font-medium text-mf-warning"
        >
          <TriangleAlert size={11} className="mt-0.5 shrink-0" aria-hidden />
          {warning.message}
        </span>
      ))}
    </div>
  );
}
