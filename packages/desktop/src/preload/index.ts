import { contextBridge, ipcRenderer } from 'electron';
import type { UpdateStatus } from '../main/auto-updater.js';

export type { UpdateStatus };

export interface UpdateAPI {
  onStatus: (callback: (status: UpdateStatus) => void) => () => void;
  check: () => Promise<unknown>;
  download: () => Promise<unknown>;
  install: () => void;
}

export interface TerminalAPI {
  create: (options: { cwd: string; cols?: number; rows?: number }) => Promise<{ id: string }>;
  write: (id: string, data: string) => Promise<void>;
  resize: (id: string, cols: number, rows: number) => Promise<void>;
  kill: (id: string) => Promise<void>;
  onData: (callback: (id: string, data: string) => void) => () => void;
  onExit: (callback: (id: string, exitCode: number) => void) => () => void;
}

export interface DaemonAPI {
  port: () => Promise<number>;
  status: () => Promise<string>;
  onStatus: (callback: (status: string) => void) => () => void;
}

export interface MainframeAPI {
  platform: NodeJS.Platform;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
  getAppInfo: () => Promise<{ version: string; author: string; homedir: string }>;
  getAuthToken: () => Promise<string | null>;
  getHomedir: () => Promise<string>;
  readFile: (filePath: string) => Promise<string | null>;
  readFileBase64: (filePath: string) => Promise<string | null>;
  showItemInFolder: (fullPath: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  clearSandboxSession: (projectId: string) => Promise<void>;
  destroyWebview: (webContentsId: number) => Promise<void>;
  showNotification: (title: string, body?: string) => Promise<void>;
  log: (level: string, module: string, message: string, data?: unknown) => void;
  terminal: TerminalAPI;
  updates: UpdateAPI;
  daemon: DaemonAPI;
}

const api: MainframeAPI = {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  getAuthToken: () => ipcRenderer.invoke('app:getAuthToken'),
  getHomedir: () => ipcRenderer.invoke('app:getHomedir'),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  readFileBase64: (filePath: string) => ipcRenderer.invoke('fs:readFileBase64', filePath),
  showItemInFolder: (fullPath: string) => ipcRenderer.invoke('shell:showItemInFolder', fullPath),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  clearSandboxSession: (projectId: string) => ipcRenderer.invoke('sandbox:clearSession', projectId),
  destroyWebview: (webContentsId: number) => ipcRenderer.invoke('webview:destroy', webContentsId),
  showNotification: (title: string, body?: string) => ipcRenderer.invoke('notify:show', title, body),
  log: (level: string, module: string, message: string, data?: unknown) =>
    ipcRenderer.send('log', level, module, message, data),
  terminal: {
    create: (options: { cwd: string; cols?: number; rows?: number }) => ipcRenderer.invoke('terminal:create', options),
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke('terminal:kill', id),
    onData: (callback: (id: string, data: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, data: string): void => callback(id, data);
      ipcRenderer.on('terminal:data', handler);
      return () => {
        ipcRenderer.removeListener('terminal:data', handler);
      };
    },
    onExit: (callback: (id: string, exitCode: number) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, exitCode: number): void => callback(id, exitCode);
      ipcRenderer.on('terminal:exit', handler);
      return () => {
        ipcRenderer.removeListener('terminal:exit', handler);
      };
    },
  },
  updates: {
    onStatus: (callback: (status: UpdateStatus) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus): void => callback(status);
      ipcRenderer.on('update-status', handler);
      return () => {
        ipcRenderer.removeListener('update-status', handler);
      };
    },
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => {
      ipcRenderer.invoke('update:install').catch((err: unknown) => {
        console.warn('[updates] install invoke failed', err);
      });
    },
  },
  daemon: {
    port: () => ipcRenderer.invoke('daemon:port'),
    status: () => ipcRenderer.invoke('daemon:status'),
    onStatus: (callback: (status: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: string): void => callback(status);
      ipcRenderer.on('daemon:status', handler);
      return () => {
        ipcRenderer.removeListener('daemon:status', handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld('mainframe', api);
