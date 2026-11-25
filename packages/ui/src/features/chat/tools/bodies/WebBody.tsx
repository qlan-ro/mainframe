/** Fetched pages and web results, in the UI face. */
import type { ReactNode } from 'react';
import { SmartLink } from '../../smart-actions/SmartLink';
import { Surface } from './Surface';

export function WebBody({ url, text, children }: { url?: string; text?: string; children?: ReactNode }) {
  return (
    <Surface mono={false} className="flex max-h-96 flex-col gap-1 overflow-y-auto px-3 py-2 font-sans text-control">
      {url && (
        <div className="w-fit max-w-full truncate text-xs leading-5" data-testid="web-fetch-card-url">
          <SmartLink href={url} className="mf-tr-fetch-link font-sans">
            {url}
          </SmartLink>
        </div>
      )}
      {children}
      {text && (
        <p data-testid="web-fetch-card-summary" className="font-sans text-control wrap-break-word whitespace-pre-wrap">
          {text}
        </p>
      )}
    </Surface>
  );
}
