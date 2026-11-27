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
  /**
   * Manual mode: how long an older page takes to arrive, in ms, like a daemon `history_page`
   * reply. Default 60, from the corrected benchmark (an older page shows ~80 ms after the
   * request, about 25 ms of which is rendering); each load varies ±30%. `delay=0` lands at once.
   */
  /**
   * Manual mode: open with only the newest N messages, like a chat whose first window is short
   * (after a compaction). The first upward scroll then has to load a page. Unset = `groups` turns.
   */
  windowItems: query.has('window') ? number('window', 2) : 0,
  /**
   * `shape=real`: the measured shape of a real tool-heavy chat's first window instead of the fixture's
   * tall turns. It holds the newest 80 items, two folded turns (33 tool calls, 5 texts and 2 thoughts;
   * 24 tool calls, 5 texts and 5 thoughts) between five short user messages, about one viewport tall,
   * and each older page of 80 items adds about one more (`fixture-real.ts`).
   */
  shape: query.get('shape') === 'real' ? ('real' as const) : ('default' as const),
  pageDelay: query.has('delay') ? Math.max(0, Number(query.get('delay')) || 0) : 60,
  /** Manual mode: the app's overlay scrollbar thumb, as in the app (it shows while scrolling or hovered). Off with `scrollbar=0`. */
  scrollbar: query.get('scrollbar') !== '0',
  /** `content-visibility: auto` on every row (the P6 fallback in the decision rule). */
  contentVisibility: query.get('cv') === '1',
  /** v1: mount the newest rows first and prepend the rest of the window in slices. */
  /** v1s: `preserveScrollOnPrepend={false}` on the Message Scroller viewport. */
  noPreserve: query.get('nopreserve') === '1',
  /** Which react-dom the bundle was built with (`RIG_PROFILE=0` builds plain). */
  react: __RIG_REACT__,
  progressive: query.get('progressive') === '1',
  /** v1: the owner with the short-window fix (`v1+fix`); `fix=2` is a scratch experiment. */
  fixOwner: Number(query.get('fix') ?? 0),
};
