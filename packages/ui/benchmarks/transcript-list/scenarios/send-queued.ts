/**
 * R-send-queued (#519): the reader follows a running turn while background tasks run, and sends. Behind a running
 * turn the send queues, as the app's does (`chat-actions.ts`): no prompt row lands in the transcript, the owner is
 * told the user sent (`announceUserSend` → `pinToBottom`) in the send's task, the composer clears, and the daemon's
 * queue snapshot puts the row in the composer (`QueuedRows`) a round trip later. In the same task the activity strip
 * above the composer changes height (`stripDrop`), and the tasks may finish (`tasksAfter`). The reply keeps
 * streaming. `idle` sends with no turn running (only the tasks), so the prompt is sent, not queued, and the reply
 * starts `think` ms later. Scored from the send: the largest gap to the bottom, frames not following, frames where
 * the position moved up with no wheel input, and where the user's message is (the queue row, or the prompt row).
 */
import { controls } from '../controls';
import { FrameLog, type FrameRecord } from '../frame-log';
import { round, sleep } from '../probe';
import { startLiveTurn } from '../live-turn';
import { store } from '../store';
import { ready } from './setup';

const SENT = 'Queued-send probe: also update the changelog.';

/** The user's message, as the reader sees it: its bottom against the viewport's (> 0: below it, out of view). */
function sentRow(viewport: HTMLElement): { present: boolean; below: number | null } {
  const queued = document.querySelector('[data-testid="chat-queued-message"]');
  const sent = [...viewport.querySelectorAll('[data-message-id]')].find((row) => row.textContent?.includes(SENT));
  const row = queued ?? sent;
  if (!row) return { present: false, below: null };
  // A queue row sits in the composer, under the viewport by layout: it is in view when the composer is.
  if (queued) return { present: true, below: 0 };
  return { present: true, below: row.getBoundingClientRect().bottom - viewport.getBoundingClientRect().bottom };
}

export async function sendQueued({
  idle = false,
  lines = 3,
  lead = 2,
  think = 600,
  watch = 4,
  tasks = 2,
  tasksAfter = tasks,
  strip = 60,
  stripDrop = 12,
  verbose = false,
}: {
  /** No turn running at the send: the prompt is sent (a row in the transcript), not queued. */
  idle?: boolean;
  lines?: number;
  /** Seconds of streaming, followed, before the send. */
  lead?: number;
  /** `idle`: ms from the send to the reply's first content. */
  think?: number;
  watch?: number;
  tasks?: number;
  /** Background tasks after the send's task (fewer: some finished as the user sent). */
  tasksAfter?: number;
  /** The activity strip's height before the send, in px. */
  strip?: number;
  /** How much shorter the strip is from the send on. */
  stripDrop?: number;
  verbose?: boolean;
}) {
  await ready(1500);
  store.set({ tasks, strip });
  const field = document.querySelector<HTMLTextAreaElement>('[data-rig-input]');
  if (!field) throw new Error('R-send-queued needs composer=real');
  const viewport = controls.viewport!;
  const stripEl = () => document.querySelector<HTMLElement>('[data-rig-strip]');
  const log = new FrameLog(viewport, () => {
    const row = sentRow(viewport);
    return {
      footer: round(document.querySelector('[data-rig-footer]')?.getBoundingClientRect().height ?? 0),
      strip: stripEl()?.getBoundingClientRect().height ?? 0,
      tasks: store.get().tasks,
      running: store.get().running,
      sentShown: row.present,
      sentBelow: row.below === null ? null : round(row.below),
    };
  });
  log.start();
  // Every scroll event, as the owner leaves it (its listener was added first): where it went and whether it follows.
  const onScroll = () =>
    log.mark(`scroll ${round(viewport.scrollTop)} ch=${viewport.clientHeight} f=${controls.isFollowing?.()}`);
  viewport.addEventListener('scroll', onScroll, { passive: true });
  let turn = idle ? null : startLiveTurn({ steps: 200, tag: 'run' });
  await sleep(lead * 1000);
  controls.setDraft?.(
    Array.from({ length: lines - 1 }, (_, i) => `Draft line ${i + 1}.`)
      .concat(SENT)
      .join('\n'),
  );
  await sleep(300);
  const jump = controls.jump;
  controls.jump = () => {
    log.mark('repin');
    jump();
  };
  controls.onSend = () => {
    store.set({ strip: strip - stripDrop, tasks: tasksAfter });
    log.mark('strip');
  };
  const from = log.records.length;
  log.mark('send');
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  if (idle) {
    // A send with no run on: the runtime lands the prompt row; the strip and tasks move in the same task.
    controls.onSend();
    await sleep(think);
    turn = startLiveTurn({ steps: 200, send: false, tag: 'next' });
    log.mark('first-content');
  }
  await sleep(watch * 1000);
  turn?.pause();
  await sleep(200);
  controls.jump = jump;
  controls.onSend = null;
  viewport.removeEventListener('scroll', onScroll);
  const records = log.stop();
  return { ...score(records.slice(from), verbose), before: verbose ? brief(records.slice(from - 3, from)) : undefined };
}

const brief = (records: FrameRecord[]) =>
  records.map((r) => ({ st: round(r.scrollTop), sh: r.scrollHeight, ch: r.clientHeight, f: r.following, x: r.extra }));

function score(records: FrameRecord[], verbose: boolean) {
  const gaps = records.map((r) => r.scrollHeight - r.clientHeight - r.scrollTop);
  const upMoves = records
    .map((r, i) => ({ r, i, step: i ? r.scrollTop - records[i - 1]!.scrollTop : 0 }))
    .filter(({ r, step }) => step < -1 && r.wheel === 0);
  const shown = records.findIndex((r) => r.extra?.sentShown === true);
  const below = records.map((r) => r.extra?.sentBelow).filter((v): v is number => typeof v === 'number');
  return {
    worstGap: round(Math.max(...gaps)),
    finalGap: round(gaps.at(-1) ?? NaN),
    notFollowing: records.filter((r) => r.following === false).length,
    firstNotFollowing: records.findIndex((r) => r.following === false),
    upMoves: upMoves.length,
    sentShownAt: shown,
    sentWorstBelow: below.length ? round(Math.max(...below)) : null,
    upEvents: upMoves.slice(0, verbose ? 100 : 6).map(({ r, i, step }) => ({
      i,
      step: round(step),
      gap: round(gaps[i]!),
      following: r.following,
      writes: r.writes,
      marks: r.marks,
    })),
    trace: verbose
      ? records.map((r, i) => ({
          i,
          t: round(r.t),
          st: round(r.scrollTop),
          sh: r.scrollHeight,
          ch: r.clientHeight,
          gap: round(gaps[i]!),
          f: r.following,
          wr: r.writes.length
            ? r.writes.map((w) => `${w.via} ${round(w.from)}→${round(w.to)} ${w.caller.split(' < ').at(-1)}`)
            : undefined,
          m: r.marks.length ? r.marks : undefined,
          x: r.extra,
        }))
      : undefined,
  };
}
