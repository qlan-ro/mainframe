export interface TerminalAPI {
  create: (options: { cwd: string }) => Promise<{ id: string }>;
  write: (id: string, data: string) => Promise<void>;
  resize: (id: string, cols: number, rows: number) => Promise<void>;
  kill: (id: string) => Promise<void>;
  onData: (callback: (id: string, data: string) => void) => void;
  onExit: (callback: (id: string, exitCode: number) => void) => void;
  removeDataListener: () => void;
  removeExitListener: () => void;
}

export interface MainframeAPI {
  platform: NodeJS.Platform;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
  getAppInfo: () => Promise<{ version: string; author: string }>;
  readFile: (filePath: string) => Promise<string | null>;
  showItemInFolder: (fullPath: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  clearSandboxSession: (projectId: string) => Promise<void>;
  showNotification: (title: string, body?: string) => Promise<void>;
  log: (level: string, module: string, message: string, data?: unknown) => void;
  terminal: TerminalAPI;
}

declare global {
  interface Window {
    mainframe: MainframeAPI;
  }
}
