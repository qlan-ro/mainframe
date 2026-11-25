/**
 * An edit's changed lines: ink on the tint, colour only in the +/− column
 * (T1b). One line number, the side the line belongs to.
 */
import { Fragment } from 'react';
import type { DiffHunk } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { ShowMore, Surface, useClampedLines } from './Surface';

interface DiffLine {
  readonly kind: 'add' | 'del' | 'ctx';
  readonly number: number;
  readonly text: string;
  /** First line of a later hunk: lines between were left out. */
  readonly gap: boolean;
}

function diffLines(hunks: readonly DiffHunk[]): DiffLine[] {
  return hunks.flatMap((hunk, hunkIndex) => {
    let before = hunk.oldStart;
    let after = hunk.newStart;
    return hunk.lines
      .filter((line) => !line.startsWith('\\'))
      .map((line, index) => {
        const kind = line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx';
        const number = kind === 'del' ? before : after;
        if (kind !== 'add') before++;
        if (kind !== 'del') after++;
        return { kind, number, text: line.slice(1), gap: index === 0 && hunkIndex > 0 } as const;
      });
  });
}

const SIGNS = { add: '+', del: '-', ctx: '' } as const;

function Row({ line }: { line: DiffLine }) {
  return (
    <div
      data-diff={line.kind}
      className={cn(
        'flex w-max min-w-full pr-3',
        line.kind === 'add' && 'mf-tr-add',
        line.kind === 'del' && 'mf-tr-del',
      )}
    >
      <span
        className={cn(
          'w-10 shrink-0 pr-3 text-right tabular-nums select-none',
          line.kind === 'ctx' && 'text-muted-foreground',
        )}
      >
        {line.number}
      </span>
      <span
        className={cn(
          'w-4.5 shrink-0 text-center font-semibold select-none',
          line.kind === 'add' && 'text-mf-tr-ok',
          line.kind === 'del' && 'text-mf-tr-del',
        )}
      >
        {line.kind === 'ctx' ? '' : <span className="sr-only">{line.kind === 'add' ? 'Added: ' : 'Removed: '}</span>}
        <span aria-hidden>{SIGNS[line.kind]}</span>
      </span>
      <span className="min-h-[19px] whitespace-pre">{line.text}</span>
    </div>
  );
}

export function DiffBody({ id, hunks, testId }: { id: string; hunks: readonly DiffHunk[]; testId: string }) {
  const lines = diffLines(hunks);
  const { shown, hidden, showAll } = useClampedLines(id, lines, 16);
  return (
    <>
      <Surface className="py-2" testId={testId}>
        {shown.map((line, index) => (
          <Fragment key={index}>
            {line.gap && (
              <div aria-hidden className="px-3 text-muted-foreground select-none">
                ⋯
              </div>
            )}
            <Row line={line} />
          </Fragment>
        ))}
      </Surface>
      {hidden > 0 && <ShowMore testId={`${testId}-more`} label={`Show ${hidden} more lines`} onClick={showAll} />}
    </>
  );
}
