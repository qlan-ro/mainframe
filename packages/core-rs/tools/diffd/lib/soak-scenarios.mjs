// The three live soak scenarios (soak.mjs §Task 4.7) and their per-daemon runner.
//
// Each scenario boots against an already-running daemon (Node or Rust), creates a
// claude chat, drives it over WS + HTTP with the REAL claude CLI, and records the
// ORDERED DaemonEvent-type sequence plus the key payload fields the port must
// preserve (message roles, permission tool names, queue events, process.*,
// chat.updated statuses). Real LLM prose differs run-to-run, so we compare
// STRUCTURE (event types + fields present); only the PARITY scenario also asserts
// the assistant text.
import { normalize, pathReplacements } from './normalize.mjs';
import { req, sleep } from './util.mjs';
import { WsSession } from './ws.mjs';

const PARITY_PROMPT = 'Reply with exactly: PARITY_OK — no tools, no thinking.';
const TOOL_PROMPT = 'Run this exact shell command with the Bash tool and nothing else: echo hello';
const LONG_PROMPT =
  'Count slowly from 1 to 200, one number per line, with a short sentence of reflection after each number. Do not stop early.';

/** Pick the cheapest model the claude adapter advertises (a non-1M Sonnet), with
 *  documented fallbacks. "Cheapest" per Task 4.7 = smallest/cheapest tier on
 *  offer; Sonnet undercuts Opus and the adapter lists no Haiku. */
export function pickCheapestModel(models) {
  const ids = models.map((m) => m.id);
  const sonnet = ids.find((id) => /sonnet/i.test(id) && !/\[1m\]/i.test(id));
  return sonnet ?? ids.find((id) => /sonnet/i.test(id)) ?? 'default';
}

async function createChat(base, projectId, model, permissionMode) {
  const body = { projectId, adapterId: 'claude', model };
  if (permissionMode) body.permissionMode = permissionMode;
  const res = await req(base, 'POST', '/api/chats', { body });
  const chatId = res.body?.data?.id ?? res.body?.data?.chat?.id ?? res.body?.id;
  return { res, chatId };
}

/** Terminal signal: a `chat.updated` whose chat.status is idle/error, after we've
 *  seen assistant activity — debounced so a mid-turn idle blip doesn't end early. */
function settleOnIdle(ws, { minAssistant = 1, debounceMs = 1800, hardCapMs }) {
  return new Promise((resolve) => {
    let timer = null;
    let assistantSeen = 0;
    let settled = false;
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      clearTimeout(hard);
      resolve(reason);
    };
    const hard = setTimeout(() => finish('hardcap'), hardCapMs);
    const onEvent = (ev) => {
      if (ev.type === 'display.message.added' || ev.type === 'message.added') assistantSeen++;
      const status = ev.chat?.status ?? ev.status;
      if (ev.type === 'chat.updated' && (status === 'idle' || status === 'error')) {
        if (assistantSeen >= minAssistant) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => finish('idle'), debounceMs);
        }
      } else if (timer && (ev.type === 'display.message.added' || ev.type === 'display.message.updated')) {
        clearTimeout(timer); // more assistant output arrived — keep waiting
        timer = null;
      }
    };
    for (const ev of ws.events) onEvent(ev); // account for events seen before attach
    ws._waiters.push({ predicate: (ev) => (onEvent(ev), false), resolve: () => {}, timer: setTimeout(() => {}, 0) });
  });
}

/** Reduce raw events to a normalized, prose-free trace for structural diffing. */
function traceOf(events, reps) {
  return events.map((ev) => {
    const n = normalize(ev, reps);
    const row = { type: n.type, keys: Object.keys(n).filter((k) => k !== 'type').sort() };
    if (n.chat && typeof n.chat === 'object') row.chatStatus = n.chat.status;
    if (typeof n.status === 'string') row.status = n.status;
    if (n.message && typeof n.message === 'object') row.role = n.message.role;
    if (n.toolName) row.toolName = n.toolName;
    if (n.behavior) row.behavior = n.behavior;
    if (Array.isArray(n.refs)) row.refsLen = n.refs.length;
    return row;
  });
}

function assistantText(events) {
  const chunks = [];
  for (const ev of events) {
    const blocks = ev?.message?.content ?? ev?.content;
    if (Array.isArray(blocks)) {
      for (const b of blocks) if (b?.type === 'text' && typeof b.text === 'string') chunks.push(b.text);
    } else if (typeof blocks === 'string') {
      chunks.push(blocks);
    }
  }
  return chunks.join('').trim();
}

async function runScenario(kind, base, ctx, spec) {
  const reps = pathReplacements({ dataDir: ctx.dataDir, roots: { REPO: ctx.repo } });
  const out = { name: spec.name, kind, ok: false, model: ctx.model };
  const { res, chatId } = await createChat(base, ctx.projectId, ctx.model, spec.permissionMode);
  if (!chatId) {
    out.error = `chat create failed: HTTP ${res.status} ${JSON.stringify(res.body)}`;
    out.createStatus = res.status;
    out.createBody = res.body;
    return out;
  }
  out.chatId = chatId;
  const ws = new WsSession(base);
  try {
    await ws.connect();
    await ws.subscribe(chatId);
    await spec.drive(ws, chatId, base);
    out.settle = await settleOnIdle(ws, spec.settle);
  } catch (e) {
    out.error = `drive failed: ${e.message}`;
  } finally {
    await sleep(200);
    ws.close();
  }
  out.eventTypes = ws.events.map((e) => e.type);
  out.trace = traceOf(ws.events, reps);
  out.assistantText = assistantText(ws.events);
  out.ok = !out.error && out.eventTypes.length > 3;
  if (spec.after) await spec.after(out, ws, base, chatId);
  return out;
}

export function buildScenarios() {
  return [
    {
      name: 'parity-text',
      permissionMode: undefined,
      settle: { minAssistant: 1, debounceMs: 1800, hardCapMs: 90000 },
      async drive(ws, chatId) {
        ws.send({ type: 'message.send', chatId, content: PARITY_PROMPT });
      },
      after(out) {
        out.parityMatch = /PARITY_OK/.test(out.assistantText);
      },
    },
    {
      name: 'tool-permission',
      permissionMode: 'default',
      settle: { minAssistant: 1, debounceMs: 2200, hardCapMs: 120000 },
      async drive(ws, chatId) {
        ws.send({ type: 'message.send', chatId, content: TOOL_PROMPT });
        // Race the permission gate against an idle settle: with some models the
        // adapter's safe-command rules auto-approve `echo` and no gate fires, so
        // we must not block the whole scenario on a request that never comes.
        const swallow = (p) => p.then((v) => v).catch(() => null);
        const perm = await Promise.race([
          swallow(ws.waitFor((ev) => ev.type === 'permission.requested', 60000, 'permission.requested')),
          swallow(
            ws.waitFor(
              (ev) => ev.type === 'chat.updated' && (ev.chat?.status ?? ev.status) === 'idle',
              60000,
              'idle',
            ).then(() => null),
          ),
        ]);
        if (perm && perm.type === 'permission.requested') {
          const r = perm.request ?? perm;
          ws.send({
            type: 'permission.respond',
            chatId,
            response: {
              requestId: r.requestId,
              toolUseId: r.toolUseId,
              toolName: r.toolName,
              behavior: 'allow',
            },
          });
        }
      },
      after(out, ws) {
        const perm = ws.events.find((e) => e.type === 'permission.requested');
        out.permissionFired = !!perm;
        out.permissionToolName = (perm?.request ?? perm)?.toolName;
        out.sawPermissionResolved = ws.events.some((e) => e.type === 'permission.resolved');
      },
    },
    {
      name: 'interrupt',
      permissionMode: undefined,
      settle: { minAssistant: 1, debounceMs: 2500, hardCapMs: 90000 },
      async drive(ws, chatId, base) {
        ws.send({ type: 'message.send', chatId, content: LONG_PROMPT });
        // Interrupt after the first assistant event lands.
        await ws.waitFor(
          (ev) => ev.type === 'display.message.added' || ev.type === 'message.added',
          60000,
          'first-assistant',
        );
        await sleep(400);
        const r = await req(base, 'POST', `/api/chats/${chatId}/interrupt`);
        ws._interruptStatus = r.status;
      },
      after(out, ws) {
        out.interruptStatus = ws._interruptStatus;
        out.sawProcessStopped = ws.events.some((e) => e.type === 'process.stopped');
      },
    },
  ];
}

/** Register the project + resolve the cheapest model, then run every scenario in
 *  sequence against one daemon. Returns per-scenario results. */
export async function runAllScenarios(kind, base, { dataDir, repo }) {
  await req(base, 'POST', '/api/projects', { body: { path: repo, name: 'soak-repo' } });
  const projRes = await req(base, 'GET', '/api/projects');
  const projectId = (projRes.body?.data ?? projRes.body ?? []).find((p) => p.path === repo)?.id;
  const adRes = await req(base, 'GET', '/api/adapters');
  const claude = (adRes.body?.data ?? adRes.body ?? []).find((a) => a.id === 'claude');
  const model = pickCheapestModel(claude?.models ?? []);
  const ctx = { projectId, model, dataDir, repo };
  const results = [];
  for (const spec of buildScenarios()) {
    results.push(await runScenario(kind, base, ctx, spec));
  }
  return { model, projectId, adapterInstalled: claude?.installed ?? null, results };
}
