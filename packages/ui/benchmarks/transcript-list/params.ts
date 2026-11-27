declare const __RIG_REACT__: 'plain' | 'profiling';

/** Query parameters: `?v=v0|v1|v1s|v2&groups=40&total=160&hold=31&live=1`. */
export type Variant = 'v0' | 'v1' | 'v1s' | 'v1s-patched' | 'v2';
const VARIANTS: Variant[] = ['v0', 'v1', 'v1s', 'v1s-patched', 'v2'];

const query = new URLSearchParams(location.search);
const number = (name: string, fallback: number) => {
  const value = Number(query.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const requested = query.get('v') as Variant | null;
const groups = number('groups', 40);

export const params = {
  variant: requested && VARIANTS.includes(requested) ? requested : ('v0' as Variant),
  /** Turns in the loaded window at open. */
  groups,
  /** Turns in the whole synthetic chat, so pages exist above the window. */
  totalTurns: number('total', groups + 120),
  /** The turn whose image the server holds until a scenario releases it. */
  holdImage: query.has('hold') ? number('hold', 0) : -1,
  /** Start with the newest turn still running (for the fold-at-turn-end cases). */
  live: query.get('live') === '1',
  /** P7 by hand: pages load near the top and the readout shows the step at each load. */
  manual: query.get('manual') === '1',
  /** `content-visibility: auto` on every row (the P6 fallback in the decision rule). */
  contentVisibility: query.get('cv') === '1',
  /** v1: mount the newest rows first and prepend the rest of the window in slices. */
  /** v1s: `preserveScrollOnPrepend={false}` on the Message Scroller viewport. */
  noPreserve: query.get('nopreserve') === '1',
  /** Which react-dom the bundle was built with (`RIG_PROFILE=0` builds plain). */
  react: __RIG_REACT__,
  progressive: query.get('progressive') === '1',
};
