type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ModuleLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

function ipcLog(level: LogLevel, module: string, message: string, data?: Record<string, unknown>): void {
  try {
    // window.mainframe may be absent in test/storybook environments
    (window as { mainframe?: { log?: (...args: unknown[]) => void } }).mainframe?.log?.(level, module, message, data);
  } catch {
    /* IPC unavailable */
  }
}

export function createLogger(module: string): ModuleLogger {
  return {
    debug(message, data) {
      ipcLog('debug', module, message, data);
    },
    info(message, data) {
      ipcLog('info', module, message, data);
    },
    warn(message, data) {
      ipcLog('warn', module, message, data);
    },
    error(message, data) {
      ipcLog('error', module, message, data);
    },
  };
}
