/**
 * Renders the production `TextUnit` (the reply's text part) with no app, daemon
 * or runtime around it. `run.mjs` drives it through `window.bench`.
 *
 * `chunk` grows the part by one chunk per synchronous render and times each
 * commit. Run it with reduced motion so the reveal shows the whole prefix at
 * once: each commit then costs what one reveal frame costs while a reply streams.
 * `live` streams with the real reveal and real timers and records every commit.
 */
import { Profiler, useState, type ProfilerOnRenderCallback } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { MessagePartState } from '@assistant-ui/react';
import { TextUnit } from '../../src/features/chat/messages/turn/TextUnit';
import type { TurnUnit } from '../../src/features/chat/view-model/turn/types';
import { LONG_REPLY, LONG_REPLY_FOOTNOTE, VISUAL_REPLY } from './content';
import '../../src/styles/app.css';

const params = new URLSearchParams(location.search);
const REPLY = params.has('footnote') ? LONG_REPLY_FOOTNOTE : LONG_REPLY;

function unitFor(text: string, running: boolean): TurnUnit {
  const part = {
    type: 'text',
    text,
    status: running ? { type: 'running' } : { type: 'complete', reason: 'stop' },
  } as MessagePartState;
  return { key: 'bench-0', messageId: 'bench-message', index: 0, part, itemId: 'bench-item' };
}

interface Commit {
  at: number;
  ms: number;
  length: number;
}

let setReply: (next: { text: string; running: boolean }) => void = () => {};
let commits: Commit[] = [];
let currentLength = 0;
const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration, _base, _start, commitTime) => {
  commits.push({ at: commitTime, ms: actualDuration, length: currentLength });
};

function Bench() {
  const [reply, set] = useState({ text: '', running: true });
  setReply = set;
  currentLength = reply.text.length;
  return (
    <div style={{ width: 720, padding: 16 }}>
      <Profiler id="reply" onRender={onRender}>
        <TextUnit unit={unitFor(reply.text, reply.running)} />
      </Profiler>
    </div>
  );
}

function chunksOf(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = size; i < text.length + size; i += size) out.push(text.slice(0, Math.min(i, text.length)));
  return out;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One synchronous render per chunk; returns the wall time of each `flushSync`. */
async function chunk(size: number) {
  flushSync(() => setReply({ text: '', running: true }));
  await wait(50);
  commits = [];
  const wall: { length: number; ms: number }[] = [];
  for (const prefix of chunksOf(REPLY, size)) {
    const start = performance.now();
    flushSync(() => setReply({ text: prefix, running: true }));
    wall.push({ length: prefix.length, ms: performance.now() - start });
  }
  return { wall, commits };
}

/** Streams with the real reveal: one chunk every `interval` ms, then waits for the reveal to finish. */
async function live(size: number, interval: number) {
  flushSync(() => setReply({ text: '', running: true }));
  await wait(50);
  commits = [];
  const started = performance.now();
  for (const prefix of chunksOf(REPLY, size)) {
    setReply({ text: prefix, running: true });
    await wait(interval);
  }
  setReply({ text: REPLY, running: false });
  await wait(1500);
  return { commits, elapsed: performance.now() - started };
}

function Visual() {
  return (
    <div id="visual" style={{ width: 720, padding: 16 }} className="bg-background">
      <TextUnit unit={unitFor(VISUAL_REPLY, false)} />
    </div>
  );
}

document.documentElement.className = params.get('theme') ?? 'light';
Object.assign(window, { bench: { chunk, live, length: REPLY.length, lines: REPLY.split('\n').length } });
createRoot(document.getElementById('root')!).render(params.has('visual') ? <Visual /> : <Bench />);
