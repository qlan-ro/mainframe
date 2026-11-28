/**
 * #518: switch away from a large chat and back. The transcript remounts and its rows land tail-first. Per frame:
 * where the newest row's bottom edge sits against the viewport's, the rows in the DOM, whether the owner follows
 * and who wrote the position. The newest row must not move once it is on screen.
 */
import { FrameLog } from '../frame-log';
import { round, sleep } from '../probe';
import { CHAT_ID, store } from '../store';
import { userMessage } from '../fixture';
import { ready } from './setup';

export async function switchBack({
  awayMs = 600,
  watchMs = 5000,
  verbose = false,
}: {
  awayMs?: number;
  watchMs?: number;
  verbose?: boolean;
}) {
  await ready(1500);
  const el = (await import('../probe')).viewport();
  const messages = store.get().messages;
  const lastId = messages.at(-1)!.id;
  // Away: another chat shows (here, none: the transcript unmounts). The app's runtime for this chat keeps its
  // messages meanwhile, so coming back mounts the transcript with every message present on its first render.
  store.set({ thread: 'away', messages: [userMessage('other-u', 1, 'A small chat.')] });
  await sleep(awayMs);
  store.set({ messages });
  await sleep(50);
  const log = new FrameLog(el);
  const edges: (number | null)[] = [];
  const started = performance.now();
  log.start();
  log.mark('back');
  store.set({ thread: CHAT_ID });
  // The newest row's bottom edge against the viewport's, every frame (after layout, like the log's own sample).
  const ro = new ResizeObserver(() => {
    const row = el.querySelector(`[data-message-id="${CSS.escape(lastId)}"]`);
    edges.push(row ? round(row.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom) : null);
  });
  const dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;left:2px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.append(dot);
  ro.observe(dot);
  let on = true;
  const tick = () => {
    if (!on) return;
    dot.style.width = dot.style.width === '1px' ? '2px' : '1px';
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  await sleep(watchMs);
  on = false;
  ro.disconnect();
  dot.remove();
  const records = log.stop();
  const shown = edges.filter((e): e is number => e !== null);
  let moves = 0;
  let lastMoveAt = -1;
  for (let i = 1; i < edges.length; i++)
    if (edges[i] !== null && edges[i - 1] !== null && Math.abs(edges[i]! - edges[i - 1]!) >= 0.5) {
      moves++;
      lastMoveAt = i;
    }
  const finalRows = records.at(-1)?.rows ?? 0;
  const fullAt = records.findIndex((r) => r.rows === finalRows);
  return {
    rows: finalRows,
    oneUnitRows: el.querySelectorAll('[data-message-id].h-px').length,
    frames: records.length,
    framesToAllRows: fullAt,
    msToAllRows: fullAt >= 0 ? round(records[fullAt]!.t - started) : NaN,
    newestMoves: moves,
    newestRange: shown.length ? round(Math.max(...shown) - Math.min(...shown)) : NaN,
    lastMoveFrame: lastMoveAt,
    writes: records.reduce((n, r) => n + r.writes.length, 0),
    notFollowing: records.filter((r) => r.following === false).length,
    edges: verbose ? edges : undefined,
    trace: verbose
      ? records.map((r, i) => ({
          i,
          st: round(r.scrollTop),
          sh: r.scrollHeight,
          f: r.following,
          rows: r.rows,
          e: edges[i],
          wr: r.writes.length
            ? r.writes.map(
                (w) =>
                  `${round(w.from, 2)}>${round(w.to, 2)} ${w.caller
                    .split(' < ')
                    .slice(1)
                    .map((c) => c.split('@')[0])
                    .join('<')}`,
              )
            : undefined,
        }))
      : undefined,
  };
}
