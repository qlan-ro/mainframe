import { contextBridge, ipcRenderer } from 'electron';

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

const api: MainframeAPI = {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  showItemInFolder: (fullPath: string) => ipcRenderer.invoke('shell:showItemInFolder', fullPath),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  clearSandboxSession: (projectId: string) => ipcRenderer.invoke('sandbox:clearSession', projectId),
  showNotification: (title: string, body?: string) => ipcRenderer.invoke('notify:show', title, body),
  log: (level: string, module: string, message: string, data?: unknown) =>
    ipcRenderer.send('log', level, module, message, data),
  terminal: {
    create: (options: { cwd: string }) => ipcRenderer.invoke('terminal:create', options),
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke('terminal:kill', id),
    onData: (callback: (id: string, data: string) => void) => {
      ipcRenderer.on('terminal:data', (_event, id: string, data: string) => callback(id, data));
    },
    onExit: (callback: (id: string, exitCode: number) => void) => {
      ipcRenderer.on('terminal:exit', (_event, id: string, exitCode: number) => callback(id, exitCode));
    },
    removeDataListener: () => {
      ipcRenderer.removeAllListeners('terminal:data');
    },
    removeExitListener: () => {
      ipcRenderer.removeAllListeners('terminal:exit');
    },
  },
};

contextBridge.exposeInMainWorld('mainframe', api);
