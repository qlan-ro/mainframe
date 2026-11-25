import { record } from '../../view-model/turn/values';

export function searchHits(text: string) {
  if (!text.startsWith('Web search results for query:')) return [];
  return Array.from(text.matchAll(/^Links: (\[.*\])$/gm), ([, json]) => {
    try {
      const links: unknown = JSON.parse(json ?? '');
      if (!Array.isArray(links)) return [];
      return links.flatMap((link: unknown) => {
        const hit = record(link);
        if (typeof hit?.title !== 'string' || typeof hit.url !== 'string') return [];
        let url: URL;
        try {
          url = new URL(hit.url);
        } catch {
          return [];
        }
        if (!['http:', 'https:'].includes(url.protocol)) return [];
        const issue = url.hostname === 'github.com' && /\/issues\/\d+\/?$/.test(url.pathname);
        return [{ title: hit.title, source: issue ? 'github.com · issue' : url.hostname }];
      });
    } catch {
      return [];
    }
  }).flat();
}
