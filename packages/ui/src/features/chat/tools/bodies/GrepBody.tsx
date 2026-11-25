import { Fragment, type ReactNode } from 'react';
import { Surface } from './Surface';

export function GrepBody({ text, pattern, fallback }: { text: string; pattern: string; fallback: ReactNode }) {
  const hits = text
    .trimEnd()
    .split('\n')
    .map((line) => /^(.+?):(\d+):(.*)$/.exec(line));
  if (hits.some((hit) => !hit)) return fallback;
  return (
    <Surface className="grid grid-cols-[max-content_max-content] gap-x-4 px-3 py-2" testId="search-card-plain-body">
      {hits.map((hit, index) => {
        const [, path, number, content] = hit!;
        const pieces = pattern ? content!.split(pattern) : [content!];
        return (
          <Fragment key={index}>
            <span className="text-muted-foreground">
              {path}:{number}
            </span>
            <span className="whitespace-pre">
              {pieces.map((piece, i) => (
                <Fragment key={i}>
                  {i > 0 && (
                    <mark className="rounded-[2px] bg-[color-mix(in_srgb,var(--warning-dot)_26%,transparent)] text-inherit">
                      {pattern}
                    </mark>
                  )}
                  {piece}
                </Fragment>
              ))}
            </span>
          </Fragment>
        );
      })}
    </Surface>
  );
}
