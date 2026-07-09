/**
 * WfExprInput — magic-variable aware expr field for workflow step config
 * forms (Task 17). The document value IS the plain `${...}` string; chips
 * (see wf-expr-chips.ts) are a view-only decoration layer.
 *
 * The CodeMirror mount (`WfExprInputEditor`) is lazy-loaded (React.lazy +
 * Suspense) — plain (non-expr) config forms never pay for the CodeMirror
 * bundle.
 */
import { lazy, Suspense } from 'react';
import { cn } from '@/lib/utils';
import type { WfScopeSource } from './wf-scope';

const WfExprInputEditor = lazy(() => import('./WfExprInputEditor').then((m) => ({ default: m.WfExprInputEditor })));

export interface WfExprInputProps {
  value: string;
  onChange: (value: string) => void;
  scope: WfScopeSource[];
  multiline?: boolean;
  testId: string;
}

function EditorFallback({ multiline, testId }: { multiline?: boolean; testId: string }): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className={cn('rounded-md border-[0.5px] border-input bg-card', multiline ? 'min-h-[80px]' : 'h-8')}
    />
  );
}

export function WfExprInput({ value, onChange, scope, multiline, testId }: WfExprInputProps): React.ReactElement {
  return (
    <Suspense fallback={<EditorFallback multiline={multiline} testId={testId} />}>
      <WfExprInputEditor
        value={value}
        onChange={onChange}
        scope={scope}
        multiline={multiline}
        testId={testId}
        onChipClick={() => undefined}
        onCursorHintConsumed={() => undefined}
      />
    </Suspense>
  );
}
