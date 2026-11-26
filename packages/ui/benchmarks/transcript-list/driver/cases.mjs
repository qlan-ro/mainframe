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
  { id: 'P6-open-400', query: '&groups=400&total=400', run: null, repeat: 3 },
  { id: 'P6-scroll-400', query: '&groups=400&total=400', run: 'p6scroll', options: {} },
  { id: 'P6-stream-400', query: '&groups=400&total=400', run: 'p4follow', options: { seconds: 5 } },
  { id: 'P7-flicks', query: '', run: 'p7proxy', options: { loads: 3 }, engines: ['wk'] },
];
