// Live probe: does the installed Claude CLI drain queued messages mid-turn,
// ack each by uuid over stream-json (--replay-user-messages), and honor
// cancel_async_message while a turn is running? Run: node packages/core/scripts/queue-probe.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'queue-probe-'));
const transcript = [];

// Do NOT set env keys to `undefined` — Node stringifies that to the literal
// "undefined". Delete the key so the child does not inherit CLAUDECODE.
const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' };
delete env.CLAUDECODE;

const child = spawn(
  'claude',
  [
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    '--replay-user-messages',
    '--permission-mode', 'bypassPermissions',
    '--allow-dangerously-skip-permissions',
  ],
  { cwd: dir, env },
);

let buffer = '';
let sessionId = '';
const seen = { replayB: null, replayC: null, replayD: null, cancelC: null, cancelD: null, result: 0 };
const write = (obj) => { transcript.push({ dir: 'in', ...obj }); child.stdin.write(JSON.stringify(obj) + '\n'); };
const userMsg = (text, uuid) => ({ type: 'user', session_id: sessionId, message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null, ...(uuid ? { uuid } : {}) });
const cancel = (uuid) => ({ type: 'control_request', request_id: `cancel-${uuid}`, request: { subtype: 'cancel_async_message', message_uuid: uuid } });

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    transcript.push({ dir: 'out', ...ev });
    // The CLI emits `system:init` more than once per session (observed live:
    // a second `init` fired mid-session). Guard onInit to fire only once, else
    // the whole probe-b/c/cancel sequence gets re-sent and the duplicate
    // control_request/user echoes below clobber the first, correct reading.
    if (ev.type === 'system' && ev.subtype === 'init' && !onInit.done) { sessionId = ev.session_id; onInit.done = true; onInit(); }
    // Keep the FIRST occurrence of each signal (first-write-wins) — a stale
    // duplicate arriving later must not overwrite a true mid-turn reading.
    if (ev.type === 'user' && (ev.isReplay || ev.is_replay)) {
      const u = ev.uuid || ev.message?.uuid || ev.message?.id;
      if (u === 'probe-b' && !seen.replayB) seen.replayB = { beforeResult: seen.result === 0 };
      if (u === 'probe-c' && !seen.replayC) seen.replayC = { beforeResult: seen.result === 0 };
      if (u === 'probe-d' && !seen.replayD) seen.replayD = { beforeResult: seen.result === 0 };
    }
    if (ev.type === 'control_response' && typeof ev.response?.response?.cancelled === 'boolean') {
      const cancelled = ev.response.response.cancelled;
      if (ev.response.request_id === 'cancel-probe-c' && !seen.cancelC) seen.cancelC = { cancelled, duringRun: seen.result === 0 };
      if (ev.response.request_id === 'cancel-probe-d' && !seen.cancelD) seen.cancelD = { cancelled };
    }
    if (ev.type === 'result' && !ev.parent_tool_use_id) onResult();
  }
});

// The CLI only emits `system:init` after it reads its first stdin write — it
// does not initialize proactively. Waiting for `init` before writing the
// kickoff message deadlocks (verified live: 40s of silence, no init, no
// exit). So the kickoff fires immediately at spawn; the rest of the sequence
// still anchors on `init` once we have a real session_id to stamp messages with.
write(userMsg('Run the Bash command `sleep 20` and then tell me you are done.'));

function onInit() {
  setTimeout(() => write(userMsg('When you get a chance, say the exact words QUEUED-B-SEEN.', 'probe-b')), 2000);
  // Send probe-c, then wait ~1.5s BEFORE cancelling so the message is actually
  // queued. A same-tick cancel can race to cancelled:false and false-trip the gate.
  setTimeout(() => write(userMsg('And also say QUEUED-C-SEEN.', 'probe-c')), 5000);
  setTimeout(() => write(cancel('probe-c')), 6500);
}

function onResult() {
  seen.result += 1;
  if (seen.result === 1) {
    // After the first turn ends, send D and cancel it shortly after — informational
    // (records cancelled:false once consumed; not a hard gate, timing-dependent).
    write(userMsg('Finally, say QUEUED-D-SEEN.', 'probe-d'));
    setTimeout(() => write(cancel('probe-d')), 500);
    setTimeout(finish, 8000);
  }
}

function finish() {
  writeFileSync(join(process.cwd(), 'docs/adapters/claude/fixtures/queue-probe-transcript.ndjson'), transcript.map((t) => JSON.stringify(t)).join('\n') + '\n');
  console.log('SESSION_ID', sessionId);
  console.log('SESSION_DIR', dir);
  console.log('RESULTS', JSON.stringify(seen, null, 2));
  child.kill('SIGTERM');
  process.exit(0);
}

setTimeout(finish, 60000);
