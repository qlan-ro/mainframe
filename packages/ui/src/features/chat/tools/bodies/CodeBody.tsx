import { TokenLine, useShikiTokens } from '@/lib/shiki-tokens';
import { ShowMore, Surface, useClampedLines } from './Surface';
import type { CodeLine } from './code-lines';

/** Numbered, highlighted lines of one file. */
export function CodeBody({
  id,
  path,
  lines,
  testId,
}: {
  id: string;
  path: string;
  lines: readonly CodeLine[];
  testId: string;
}) {
  const { shown, hidden, showAll } = useClampedLines(id, lines);
  const tokens = useShikiTokens(shown.map((line) => line.text).join('\n'), path.split('.').pop());
  return (
    <>
      <Surface className="py-2" testId={testId}>
        {shown.map((line, index) => (
          <div key={line.number} className="flex w-max min-w-full pr-3">
            <span className="w-10 shrink-0 pr-3 text-right text-muted-foreground tabular-nums select-none">
              {line.number}
            </span>
            <span className="min-h-[19px] whitespace-pre">
              {tokens?.[index] ? <TokenLine tokens={tokens[index]!} addNewline={false} /> : line.text}
            </span>
          </div>
        ))}
      </Surface>
      {hidden > 0 && <ShowMore testId={`${testId}-more`} label={`Show all ${lines.length} lines`} onClick={showAll} />}
    </>
  );
}
