import { powerMonitor } from 'electron';
import { createMainLogger } from './logger.js';

const log = createMainLogger('idle-reporter');

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const IDLE_THRESHOLD_S = 5 * 60; // 5 minutes in seconds
const DAEMON_HOST = process.env['DAEMON_HOST'] ?? '127.0.0.1';
const DAEMON_PORT = process.env['DAEMON_PORT'] ?? '31415';
const DAEMON_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}`;

let currentState: 'active' | 'idle' = 'active';
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function reportState(state: 'active' | 'idle'): Promise<void> {
  try {
    await fetch(`${DAEMON_URL}/api/device/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
  } catch {
    log.warn({ state }, 'failed to report activity state to daemon');
  }
}

function checkIdle(): void {
  const idleSeconds = powerMonitor.getSystemIdleTime();
  const newState: 'active' | 'idle' = idleSeconds >= IDLE_THRESHOLD_S ? 'idle' : 'active';

  if (newState !== currentState) {
    currentState = newState;
    log.info({ state: currentState, idleSeconds }, 'desktop state transition');
    reportState(currentState);
  }
}

export function startIdleReporter(): void {
  reportState('active');
  pollTimer = setInterval(checkIdle, POLL_INTERVAL_MS);
  log.info('idle reporter started');
}

export function stopIdleReporter(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  reportState('idle');
  log.info('idle reporter stopped');
}
