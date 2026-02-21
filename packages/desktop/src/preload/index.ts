import { contextBridge, ipcRenderer } from 'electron';

export interface MainframeAPI {
  platform: NodeJS.Platform;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
  getAppInfo: () => Promise<{ version: string; author: string }>;
  openDirectoryDialog: () => Promise<string | null>;
  readFile: (filePath: string) => Promise<string | null>;
  log: (level: string, module: string, message: string, data?: unknown) => void;
}

const api: MainframeAPI = {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  log: (level: string, module: string, message: string, data?: unknown) =>
    ipcRenderer.send('log', level, module, message, data),
};

contextBridge.exposeInMainWorld('mainframe', api);
