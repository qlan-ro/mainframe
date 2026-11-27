// The P1-P7 scenarios as page loads: each case is one fresh page with its query and scenario call.
const HOLD = 136; // a turn with an image inside the default window (turns 120-159)
export const CASES = [
  { id: 'P1-middle', query: '', run: 'p1', options: { at: 'middle' } },
  { id: 'P1-top', query: '', run: 'p1', options: { at: 'top' } },
  { id: 'P2-control', query: '', run: 'p2', options: { prepend: false } },
  { id: 'P2-page', query: '', run: 'p2', options: { prepend: true } },
  ...['up', 'down'].flatMap((dir) => [
    { id: `P3-image-${dir}`, query: `&hold=${HOLD}`, run: 'p3', options: { change: 'image', dir, turn: HOLD } },
    { id: `P3-code-${dir}`, query: '', run: 'p3', options: { change: 'code', dir, turn: HOLD } },
    { id: `P3-fold-${dir}`, query: '&live=1', run: 'p3', options: { change: 'fold', dir } },
  ]),
  { id: 'P4-follow', query: '', run: 'p4follow', options: {} },
  { id: 'P4-wheel-up', query: '', run: 'p4release', options: { dy: -120 } },
  { id: 'P4-wheel-down', query: '', run: 'p4release', options: { dy: 120 } },
  { id: 'P5-open', query: '', run: null, repeat: 5 },
  { id: 'P6-open-10', query: '&groups=10', run: null, repeat: 5 },
  { id: 'P6-open-20', query: '&groups=20', run: null, repeat: 5 },
  // A short tail: the real shape's newest rows are shorter than the viewport, so a tail-first mount that shows them
  // before the list overflows paints them at the top and then jumps them to the bottom. Boot only; `newestMoved` is the jump.
  { id: 'B-short', query: '&shape=real&window=24', run: null, repeat: 5 },
  { id: 'P6-open-400', query: '&groups=400&total=400', run: null, repeat: 3 },
  { id: 'P6-scroll-400', query: '&groups=400&total=400', run: 'p6scroll', options: {} },
  { id: 'P6-stream-400', query: '&groups=400&total=400', run: 'p4follow', options: { seconds: 5 } },
  // Tail-first mount scored to completion (run with `--variants v1+progressive`): the time the whole window
  // is in and the longest task per slice, then P1-P4 started with no settle wait, while slices still land.
  { id: 'P6-tail', query: '', run: 'p6tail', options: {}, onlyProgressive: true },
  { id: 'P6-tail-400', query: '&groups=400&total=400', run: 'p6tail', options: {}, onlyProgressive: true },
  { only: 'tail', id: 'E-P1-middle', query: '', run: 'p1', options: { at: 'middle', eager: true } },
  { only: 'tail', id: 'E-P1-top', query: '', run: 'p1', options: { at: 'top', eager: true } },
  { only: 'tail', id: 'E-P2-control', query: '', run: 'p2', options: { prepend: false, eager: true } },
  { only: 'tail', id: 'E-P2-page', query: '', run: 'p2', options: { prepend: true, eager: true } },
  {
    only: 'tail',
    id: 'E-P3-code-up',
    query: '',
    run: 'p3',
    options: { change: 'code', dir: 'up', turn: HOLD, eager: true },
  },
  {
    only: 'tail',
    id: 'E-P3-fold-up',
    query: '&live=1',
    run: 'p3',
    options: { change: 'fold', dir: 'up', eager: true },
  },
  { only: 'tail', id: 'E-P4-follow', query: '', run: 'p4follow', options: { eager: true } },
  { only: 'tail', id: 'E-P4-wheel-up', query: '', run: 'p4release', options: { dy: -120, eager: true } },
  { only: 'tail', id: 'E-P4-wheel-down', query: '', run: 'p4release', options: { dy: 120, eager: true } },
  // S-top: a short first window, the reader at the top, and an older page landing 60 ms (+-30%) after the request
  // while the wheel keeps going: fixed -60 px and -300 px steps, and (WKWebView only) momentum flicks with the
  // harness's real NSEvent phases. `window=2` is the newest two messages (2.2-2.5 viewports here), with the reader
  // walking up from the tail or parked at offset 0 first (`park`); `shape=real` is the measured shape of a real
  // first window (two folded tool-heavy turns, about one viewport, 80-item pages), where the reader reaches the top at once.
  ...[
    ['', '&window=2', {}],
    ['-park', '&window=2', { park: true }],
    ['-real', '&shape=real', {}],
  ].flatMap(([name, query, extra]) => [
    { id: `S-top${name}-60`, query, run: 'sTop', options: { dy: -60, steps: 40, ...extra } },
    { id: `S-top${name}-300`, query, run: 'sTop', options: { dy: -300, steps: 10, ...extra } },
    { id: `S-top${name}-flick`, query, run: 'sTop', options: { dy: -700, flicks: 2, ...extra }, engines: ['wk'] },
  ]),
  // The ledger's own error: the same input with no page landing, scored over every 20-frame window.
  { id: 'S-noise-60', query: '', run: 'sNoise', options: { dy: -60, steps: 40 } },
  { id: 'S-noise-300', query: '', run: 'sNoise', options: { dy: -300, steps: 10 } },
  { id: 'S-noise-flick', query: '', run: 'sNoise', options: { dy: -700, flicks: 2 }, engines: ['wk'] },
  // #462: the window stays bounded. Scroll up 10 pages and back down, twice, on the app's list (`--variants app`).
  { id: 'W-bound', query: '&total=400', run: 'bound', options: { pages: 10, cycles: 2 }, engines: ['wk'] },
  { id: 'P7-flicks', query: '', run: 'p7proxy', options: { loads: 3 }, engines: ['wk'] },
  // #463: a long sub-agent's steps (`--variants agent,agent+inline,agent+plain=0,agent+inline+plain=0`). A-park: one
  // older page lands under a parked reader (400 px into the steps, or at offset 0 in the tab). A-wheel: the reader
  // wheels up through several pages, each landing 60 ms (+-30%) after the app's gesture asks. A-bound: 20 pages up
  // and back down on a 2,000-step sub-agent; what the DOM and the held entry hold at each point.
  { id: 'A-park-middle', query: '', run: 'agentPark', options: { at: 'middle' }, only: 'agent' },
  { id: 'A-park-top', query: '', run: 'agentPark', options: { at: 'top' }, only: 'agent-tab' },
  { id: 'A-wheel', query: '', run: 'agentWheel', options: { dy: -120, steps: 60 }, only: 'agent' },
  { id: 'A-bound', query: '', run: 'agentBound', options: { pages: 20 }, only: 'agent', engines: ['wk'] },
];
