/**
 * Integration test: verifies that the `set_model` control request actually
 * changes the model used by the Claude CLI for subsequent API calls.
 *
 * This test spawns a REAL Claude CLI process, so it requires:
 * - `claude` binary on PATH
 * - Valid Claude credentials
 * - Network access
 *
 * Run manually:  pnpm --filter @mainframe/core vitest run src/__tests__/set-model-integration.test.ts
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';

interface StreamEvent {
  type: string;
  subtype?: string;
  message?: {
    model?: string;
    content?: Array<{ type: string; text?: string; thinking?: string }>;
  };
  session_id?: string;
  [key: string]: unknown;
}

function spawnCLI(model: string): {
  child: ChildProcess;
  events: StreamEvent[];
  written: string[];
  waitForEvent: (predicate: (e: StreamEvent) => boolean, timeoutMs?: number) => Promise<StreamEvent>;
} {
  const args = [
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '--model',
    model,
    '--max-turns',
    '1',
    '--permission-prompt-tool',
    'stdio',
    '-p',
    'placeholder',
  ];

  const child = spawn('claude', args, {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CLAUDECODE: '' },
  });

  const events: StreamEvent[] = [];
  const written: string[] = [];
  let buffer = '';

  child.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line.trim()) as StreamEvent;
        events.push(event);
      } catch {
        /* skip non-JSON */
      }
    }
  });

  child.stderr!.on('data', (chunk: Buffer) => {
    const msg = chunk.toString().trim();
    if (msg) console.error('[cli stderr]', msg);
  });

  function waitForEvent(predicate: (e: StreamEvent) => boolean, timeoutMs = 60_000): Promise<StreamEvent> {
    return new Promise((resolve, reject) => {
      // Check already-received events
      const existing = events.find(predicate);
      if (existing) return resolve(existing);

      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Timed out waiting for event (${timeoutMs}ms). Received ${events.length} events: ${events.map((e) => e.type + (e.subtype ? ':' + e.subtype : '')).join(', ')}`,
          ),
        );
      }, timeoutMs);

      function onData(chunk: Buffer) {
        // Re-check after new data arrives (events are pushed in the stdout handler)
        const match = events.find(predicate);
        if (match) {
          cleanup();
          resolve(match);
        }
      }

      function cleanup() {
        clearTimeout(timer);
        child.stdout!.removeListener('data', onData);
      }

      child.stdout!.on('data', onData);
    });
  }

  return { child, events, written, waitForEvent };
}

function writeStdin(child: ChildProcess, payload: Record<string, unknown>): void {
  child.stdin!.write(JSON.stringify(payload) + '\n');
}

function sendControlRequest(child: ChildProcess, request: Record<string, unknown>): void {
  writeStdin(child, {
    type: 'control_request',
    request_id: crypto.randomUUID(),
    request,
  });
}

function sendUserMessage(child: ChildProcess, sessionId: string, text: string): void {
  writeStdin(child, {
    type: 'user',
    session_id: sessionId,
    message: { role: 'user', content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
  });
}

describe.skipIf(!!process.env.CI)('set_model integration', () => {
  let cli: ReturnType<typeof spawnCLI> | null = null;

  afterEach(() => {
    if (cli?.child && !cli.child.killed) {
      cli.child.kill('SIGTERM');
    }
    cli = null;
  });

  it('set_model changes the model for subsequent API calls', async () => {
    // 1. Spawn CLI with Haiku (cheap + fast for the initial handshake)
    cli = spawnCLI('claude-haiku-4-5-20251001');

    // 2. Wait for system:init — the CLI is ready
    //    system:init only fires after the first API call, so we need to
    //    send the first user message first.
    sendUserMessage(cli.child, '', 'say "hello" and nothing else');

    const initEvent = await cli.waitForEvent((e) => e.type === 'system' && e.subtype === 'init');
    const sessionId = initEvent.session_id as string;
    expect(sessionId).toBeTruthy();
    console.log('[test] session started:', sessionId, 'model:', initEvent.model);

    // 3. Wait for the first result (turn complete)
    await cli.waitForEvent((e) => e.type === 'result');
    console.log('[test] first turn complete');

    // 4. Verify initial model was Haiku
    const firstAssistant = cli.events.find((e) => e.type === 'assistant' && e.message?.model);
    expect(firstAssistant?.message?.model).toContain('haiku');

    // 5. Send set_model to switch to Sonnet
    sendControlRequest(cli.child, {
      subtype: 'set_model',
      model: 'claude-sonnet-4-5-20250929',
    });

    // Small delay for the CLI to process the control request
    await new Promise((r) => setTimeout(r, 500));

    // 6. Send a second message asking which model it is
    sendUserMessage(
      cli.child,
      sessionId,
      'What is your exact model ID? Reply with ONLY the model ID string, nothing else.',
    );

    // 7. Wait for the second assistant response
    const resultsBefore = cli.events.filter((e) => e.type === 'result').length;
    await cli.waitForEvent(
      (e) => e.type === 'result' && cli!.events.filter((r) => r.type === 'result').length > resultsBefore,
    );

    // 8. Find the second assistant event and verify the model is Sonnet
    const allAssistant = cli.events.filter((e) => e.type === 'assistant' && e.message?.model);
    const secondAssistant = allAssistant[allAssistant.length - 1];
    console.log('[test] second assistant model:', secondAssistant?.message?.model);

    expect(secondAssistant?.message?.model).toContain('sonnet');
  }, 90_000); // generous timeout for real API calls
});
