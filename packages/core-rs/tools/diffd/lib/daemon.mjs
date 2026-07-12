// Boot / stop a single daemon (Node dist or the Rust binary) on its own data
// dir + port, with clean env and SIGTERM→SIGKILL shutdown.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { cleanEnv, sleep, waitForHealth } from './util.mjs';

export class Daemon {
  constructor({ kind, cmd, args, dataDir, port, logPath, cwd }) {
    this.kind = kind; // 'node' | 'rust'
    this.cmd = cmd;
    this.args = args;
    this.dataDir = dataDir;
    this.port = port;
    this.logPath = logPath;
    this.cwd = cwd;
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.proc = null;
  }

  async start() {
    const log = fs.openSync(this.logPath, 'a');
    const env = cleanEnv({
      DAEMON_PORT: String(this.port),
      MAINFRAME_DATA_DIR: this.dataDir,
      LOG_LEVEL: 'error',
    });
    this.proc = spawn(this.cmd, this.args, {
      cwd: this.cwd,
      env,
      stdio: ['ignore', log, log],
      detached: false,
    });
    this.proc.on('exit', (code, signal) => {
      this.exited = { code, signal };
    });
    try {
      await waitForHealth(this.baseUrl, 40000);
    } catch (e) {
      const tail = fs.existsSync(this.logPath)
        ? fs.readFileSync(this.logPath, 'utf8').split('\n').slice(-25).join('\n')
        : '(no log)';
      throw new Error(`${this.kind} daemon failed to become healthy: ${e.message}\n--- log tail ---\n${tail}`);
    }
    return this;
  }

  async stop() {
    if (!this.proc || this.exited) return;
    this.proc.kill('SIGTERM');
    for (let i = 0; i < 50 && !this.exited; i++) await sleep(100);
    if (!this.exited) {
      this.proc.kill('SIGKILL');
      await sleep(300);
    }
  }
}
