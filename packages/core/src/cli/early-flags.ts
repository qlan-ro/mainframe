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
if (arg === '--help' || arg === '-h' || arg === 'help') {
  console.log(
    [
      '',
      '  mainframe — AI-native development environment daemon',
      '',
      '  Usage: mainframe [command]',
      '',
      '  Commands:',
      '    (none)             start the daemon (default)',
      '    pair                pair a new device via QR code',
      '    status              show daemon health and status',
      '    update [opts]       self-update the standalone install',
      '    help                show this help',
      '',
      '  Flags:',
      '    -v, --version       print the daemon version',
      '    -h, --help          show this help',
      '',
      '  Run `mainframe update --help` for update-specific options.',
      '',
    ].join('\n'),
  );
  process.exit(0);
}
