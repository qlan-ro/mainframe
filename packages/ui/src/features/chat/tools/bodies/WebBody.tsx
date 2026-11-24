/** Fetched pages and web results, in the UI face. */
import { useOpenLink } from '../../links/use-open-link';
import { Surface } from './Surface';

function FetchedLink({ url }: { url: string }) {
  const { open } = useOpenLink();
  return (
    <button
      type="button"
      data-testid="web-fetch-card-url"
      onClick={() => open(url)}
      className="mf-link mf-tr-meta block max-w-full truncate rounded-sm text-left focus-visible:focus-line"
    >
      {url}
    </button>
  );
}

export function WebBody({ url, text }: { url?: string; text: string }) {
  return (
    <Surface className="flex max-h-96 flex-col gap-1 overflow-y-auto px-3 py-2 font-sans text-sm">
      {url && <FetchedLink url={url} />}
      {text && (
        <p data-testid="web-fetch-card-summary" className="font-sans text-sm wrap-break-word whitespace-pre-wrap">
          {text}
        </p>
      )}
    </Surface>
  );
}
