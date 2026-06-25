/**
 * sandbox store — behavior tests.
 *
 * Behaviors covered:
 *  - addCapture assigns a string id and caps captures at 500 (NEW behavior vs desktop)
 *  - removeCapture removes by id
 *  - clearCaptures empties the list
 *  - appendLog trims the log to max 500 entries (preserves newest)
 *  - setProcessStatus keys by scope and never bleeds across scopes
 *  - clearLogs empties logsOutput
 *  - clearLogsForProcess removes only matching scope+name entries
 *  - setSelectedConfigName and setLastStartedProcess update the named fields
 */
import { it, expect, beforeEach, describe } from 'vitest';
import { useSandboxStore } from '../sandbox';

const INITIAL_STATE = {
  captures: [],
  processStatuses: {},
  logsOutput: [],
  selectedConfigName: null,
  lastStartedProcess: null,
};

beforeEach(() => {
  useSandboxStore.setState(INITIAL_STATE);
});

// ---------------------------------------------------------------------------
// addCapture
// ---------------------------------------------------------------------------

describe('addCapture', () => {
  it('assigns a string id to each capture', () => {
    useSandboxStore.getState().addCapture({ type: 'screenshot', imageDataUrl: 'data:image/png;base64,abc' });
    const caps = useSandboxStore.getState().captures;
    expect(caps).toHaveLength(1);
    expect(typeof caps[0]!.id).toBe('string');
    expect(caps[0]!.id.length).toBeGreaterThan(0);
  });

  it('caps captures at 500 — oldest entries are dropped when over the limit', () => {
    for (let i = 0; i < 510; i++) {
      useSandboxStore.getState().addCapture({ type: 'screenshot', imageDataUrl: `d${i}` });
    }
    const caps = useSandboxStore.getState().captures;
    expect(caps).toHaveLength(500);
    // The first 10 (d0–d9) should have been dropped
    expect(caps[0]!.imageDataUrl).toBe('d10');
    expect(caps[499]!.imageDataUrl).toBe('d509');
  });

  it('preserves selector and annotation on element captures', () => {
    useSandboxStore.getState().addCapture({
      type: 'element',
      imageDataUrl: 'data:image/png;base64,xyz',
      selector: 'button.primary',
      annotation: 'Click me',
    });
    const cap = useSandboxStore.getState().captures[0]!;
    expect(cap.type).toBe('element');
    expect(cap.selector).toBe('button.primary');
    expect(cap.annotation).toBe('Click me');
  });
});

// ---------------------------------------------------------------------------
// removeCapture
// ---------------------------------------------------------------------------

describe('removeCapture', () => {
  it('removes the capture with the matching id', () => {
    useSandboxStore.getState().addCapture({ type: 'screenshot', imageDataUrl: 'data:a' });
    useSandboxStore.getState().addCapture({ type: 'screenshot', imageDataUrl: 'data:b' });
    const id = useSandboxStore.getState().captures[0]!.id;
    useSandboxStore.getState().removeCapture(id);
    expect(useSandboxStore.getState().captures).toHaveLength(1);
    expect(useSandboxStore.getState().captures[0]!.imageDataUrl).toBe('data:b');
  });
});

// ---------------------------------------------------------------------------
// clearCaptures
// ---------------------------------------------------------------------------

describe('clearCaptures', () => {
  it('empties the captures list', () => {
    useSandboxStore.getState().addCapture({ type: 'screenshot', imageDataUrl: 'data:a' });
    useSandboxStore.getState().clearCaptures();
    expect(useSandboxStore.getState().captures).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// appendLog
// ---------------------------------------------------------------------------

describe('appendLog', () => {
  it('appends a log entry with the given fields', () => {
    useSandboxStore.getState().appendLog('proj:/p', 'dev', 'hello', 'stdout');
    const logs = useSandboxStore.getState().logsOutput;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({
      seq: expect.any(Number),
      scopeKey: 'proj:/p',
      name: 'dev',
      data: 'hello',
      stream: 'stdout',
    });
  });

  it('assigns monotonically increasing seq numbers', () => {
    useSandboxStore.getState().appendLog('proj:/p', 'dev', 'first', 'stdout');
    useSandboxStore.getState().appendLog('proj:/p', 'dev', 'second', 'stdout');
    const logs = useSandboxStore.getState().logsOutput;
    expect(logs[1]!.seq).toBeGreaterThan(logs[0]!.seq);
  });

  it('trims log entries to max 500 (preserves newest)', () => {
    for (let i = 0; i < 510; i++) {
      useSandboxStore.getState().appendLog('proj:/p', 'dev', `line${i}`, 'stdout');
    }
    const logs = useSandboxStore.getState().logsOutput;
    expect(logs).toHaveLength(500);
    expect(logs[0]!.data).toBe('line10');
    expect(logs[499]!.data).toBe('line509');
  });
});

// ---------------------------------------------------------------------------
// setProcessStatus
// ---------------------------------------------------------------------------

describe('setProcessStatus', () => {
  it('keys by scope and never bleeds across scopes', () => {
    useSandboxStore.getState().setProcessStatus('proj:/a', 'dev', 'running');
    useSandboxStore.getState().setProcessStatus('proj:/b', 'dev', 'stopped');
    const s = useSandboxStore.getState().processStatuses;
    expect(s['proj:/a']!['dev']).toBe('running');
    expect(s['proj:/b']!['dev']).toBe('stopped');
  });

  it('updates status for an existing scope+name without touching others', () => {
    useSandboxStore.getState().setProcessStatus('proj:/a', 'dev', 'starting');
    useSandboxStore.getState().setProcessStatus('proj:/a', 'api', 'running');
    useSandboxStore.getState().setProcessStatus('proj:/a', 'dev', 'running');
    const s = useSandboxStore.getState().processStatuses['proj:/a']!;
    expect(s['dev']).toBe('running');
    expect(s['api']).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// clearLogs / clearLogsForProcess
// ---------------------------------------------------------------------------

describe('clearLogs', () => {
  it('empties logsOutput entirely', () => {
    useSandboxStore.getState().appendLog('proj:/p', 'dev', 'hi', 'stdout');
    useSandboxStore.getState().clearLogs();
    expect(useSandboxStore.getState().logsOutput).toHaveLength(0);
  });
});

describe('clearLogsForProcess', () => {
  it('removes only entries matching scopeKey+name', () => {
    useSandboxStore.getState().appendLog('proj:/a', 'dev', 'a-dev', 'stdout');
    useSandboxStore.getState().appendLog('proj:/a', 'api', 'a-api', 'stdout');
    useSandboxStore.getState().appendLog('proj:/b', 'dev', 'b-dev', 'stdout');
    useSandboxStore.getState().clearLogsForProcess('proj:/a', 'dev');
    const logs = useSandboxStore.getState().logsOutput;
    expect(logs).toHaveLength(2);
    expect(logs.find((l) => l.data === 'a-dev')).toBeUndefined();
    expect(logs.find((l) => l.data === 'a-api')).toBeDefined();
    expect(logs.find((l) => l.data === 'b-dev')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// setSelectedConfigName / setLastStartedProcess
// ---------------------------------------------------------------------------

describe('setSelectedConfigName', () => {
  it('sets and clears the selected config name', () => {
    useSandboxStore.getState().setSelectedConfigName('dev');
    expect(useSandboxStore.getState().selectedConfigName).toBe('dev');
    useSandboxStore.getState().setSelectedConfigName(null);
    expect(useSandboxStore.getState().selectedConfigName).toBeNull();
  });
});

describe('setLastStartedProcess', () => {
  it('sets and clears the last started process name', () => {
    useSandboxStore.getState().setLastStartedProcess('api');
    expect(useSandboxStore.getState().lastStartedProcess).toBe('api');
    useSandboxStore.getState().setLastStartedProcess(null);
    expect(useSandboxStore.getState().lastStartedProcess).toBeNull();
  });
});
