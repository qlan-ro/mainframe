import { DAEMON_VERSION } from '../version.js';

/**
 * Handle argv flags that must answer *before* the daemon's module graph loads.
 *
 * index.ts imports this first, so `mainframe --version` prints and exits before
 * the logger (and its pino file destination), the DB, or the server are ever
 * evaluated — no log-line noise on stdout, no slow boot, no sonic-boom flush race.
 */
const arg = process.argv[2];
if (arg === '--version' || arg === '-v' || arg === 'version') {
  console.log(`mainframe ${DAEMON_VERSION}`);
  process.exit(0);
}
