declare const __RIG_REACT__: 'plain' | 'profiling';

/** Query parameters: `?v=v0|v1|v1s|v2&groups=40&total=160&hold=31&live=1`. */
export type Variant = 'v0' | 'v1' | 'v1s' | 'v1s-patched' | 'v2' | 'app' | 'agent';
const VARIANTS: Variant[] = ['v0', 'v1', 'v1s', 'v1s-patched', 'v2', 'app', 'agent'];

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
  shape: (['real', 'heavy'].includes(query.get('shape') ?? '') ? query.get('shape') : 'default') as
    'real' | 'heavy' | 'default',
  /** `shape=heavy`: assistant messages per turn (one tool call each), so a folded turn draws `per - 2` rows of 1 px. */
  perTurn: number('per', 150),
  pageDelay: query.has('delay') ? Math.max(0, Number(query.get('delay')) || 0) : 60,
  /**
   * Manual mode: the overlay scrollbar thumb. Off by default, as the app's transcript has none (it jumped and
   * resized as older pages landed); `scrollbar=1` brings it back for a comparison.
   */
  scrollbar: query.get('scrollbar') === '1',
  /** `composer=real`: assistant-ui's autosizing composer input instead of the stub; Enter sends through `onNew`. */
  realComposer: query.get('composer') === 'real',
  /**
   * `queue=1` (`app`, with `composer=real`): the footer the app draws while a turn runs: an activity strip stub above
   * the composer and the real `QueuedRows` in it. A send while the run is on queues, as the app's does: no prompt row
   * in the transcript, the user-sent re-pin, and the daemon's queue snapshot `rtt` ms later (default 40; `rtt=0`
   * lands it right after the send's task, before the next frame).
   */
  queue: query.get('queue') === '1',
  /** `composer=real&chips=1`: the app's chip field (Lexical, Settings › Chat) instead of the textarea. */
  chips: query.get('chips') === '1',
  /** `app`: the owner is not given the footer, so it samples nothing there (the footer observer's A/B, `R-type`). */
  noFooter: query.get('nofooter') === '1',
  rtt: query.has('rtt') ? Math.max(0, Number(query.get('rtt')) || 0) : 40,
  /** `content-visibility: auto` on every row (the P6 fallback in the decision rule). */
  contentVisibility: query.get('cv') === '1',
  /** v1: mount the newest rows first and prepend the rest of the window in slices. */
  /** v1s: `preserveScrollOnPrepend={false}` on the Message Scroller viewport. */
  noPreserve: query.get('nopreserve') === '1',
  /** Which react-dom the bundle was built with (`RIG_PROFILE=0` builds plain). */
  react: __RIG_REACT__,
  progressive: query.get('progressive') === '1',
  /** v1: the owner with the first short-window prototype (`v1+fix`): an absolute `scrollTop` write. Fails, kept for the record. */
  fixOwner: Number(query.get('fix') ?? 0),
  /** v1: the near-top correction (`v1+near`): relative `scrollBy` after layout, browser anchoring left on. */
  nearFix: query.get('near') === '1',
  /** `agent`: containers in the long sub-agent (`agent-pager.ts`, 40 a page). */
  agentSteps: number('steps', 2000),
  /** `agent`: the steps inline in the chat's own list (its owner, opened at the tail) instead of the sub-agent tab. */
  inline: query.get('inline') === '1',
  /** `agent`: Settings › Chat › plain transcript list; `plain=0` is the other list, for a comparison. */
  plain: query.get('plain') !== '0',
};
