/** P4: following a streaming run, releasing it with the wheel, and the jump back. */
import { Recorder, frame, frames, gapOf, percentile, round, sleep, viewport, type Sample } from '../probe';
import { wheel } from '../input';
import { controls } from '../controls';
import { ready } from './setup';
import { renderPerChunk, startStream, type StreamStats } from './stream';

/** Frames after the first live-edge frame (gap <= 1): a new turn may first settle near the top (v1s). */
function fromLiveEdge(samples: Sample[]) {
  const at = samples.findIndex((s) => s.gap <= 1);
  return { reachedAt: at, after: at < 0 ? [] : samples.slice(at) };
}

/** The worst bottom gap over some frames. No frames is no evidence, so it is Infinity (null in JSON), never 0. */
const worstGap = (samples: Sample[]) => (samples.length ? round(Math.max(...samples.map((s) => s.gap))) : Infinity);

/** 10 s at 30 chunks/s with a row every 250 ms, then the run ends and its work folds. */
export async function p4follow({
  seconds = 10,
  debug = false,
  eager = false,
}: {
  seconds?: number;
  debug?: boolean;
  eager?: boolean;
}) {
  await ready(1500, eager);
  const el = viewport();
  const stats: StreamStats = { commits: [], marks: [] };
  const recorder = new Recorder(el);
  recorder.start();
  await sleep(200);
  const atSend = recorder.samples.length;
  const stop = startStream(stats);
  await sleep(seconds * 1000);
  const renders = renderPerChunk(stats);
  const beforeFold = el.scrollHeight;
  recorder.mark('end');
  const endIndex = recorder.samples.length;
  await stop();
  await sleep(1500);
  const samples = recorder.stop();
  const live = fromLiveEdge(samples.slice(atSend + 2));
  const gaps = samples.slice(atSend).map((s) => Math.round(s.gap));
  const intervals = samples.slice(1).map((s, i) => s.t - samples[i]!.t);
  return {
    framesToLiveEdge: live.reachedAt,
    reachedLiveEdge: live.reachedAt >= 0,
    worstGapStreaming: worstGap(live.after.slice(0, Math.max(0, endIndex - atSend - 2 - live.reachedAt))),
    worstGapAfterFold: worstGap(samples.slice(endIndex)),
    foldHeight: round(beforeFold - el.scrollHeight),
    renderP95: round(percentile(renders, 95)),
    renderP50: round(percentile(renders, 50)),
    writeToDomP95: round(percentile(stats.commits, 95)),
    chunks: stats.commits.length,
    frameP95: round(percentile(intervals, 95)),
    gaps: debug ? gaps : undefined,
  };
}

/** A wheel while following: up 120 px must release (and stay released); down must not. Then the jump. */
export async function p4release({ dy = -120, eager = false }: { dy?: number; eager?: boolean }) {
  await ready(1500, eager);
  const el = viewport();
  const recorder = new Recorder(el);
  recorder.start();
  const stop = startStream({ commits: [] });
  await sleep(3000);
  await wheel(dy);
  await sleep(300);
  const atWheel = recorder.samples.length;
  await sleep(2000);
  const afterWheel = recorder.samples.slice(atWheel);
  const top = afterWheel[0]?.scrollTop ?? el.scrollTop;
  const stayedReleased = afterWheel.every((s) => s.gap > 1 && s.scrollTop <= top + 2);
  const stayedFollowing = afterWheel.every((s) => s.gap <= 1);
  controls.jump();
  let jumpFrames = -1;
  for (let i = 1; i <= 30; i++) {
    await frame();
    if (gapOf(el) <= 1) {
      jumpFrames = i;
      break;
    }
  }
  const atJump = recorder.samples.length;
  await sleep(1500);
  const resumed = worstGap(recorder.samples.slice(atJump + 2));
  await stop();
  await frames(2);
  recorder.stop();
  return { dy, stayedReleased, stayedFollowing, jumpFrames, worstGapAfterJump: resumed };
}
