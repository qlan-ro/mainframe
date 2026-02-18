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
};

contextBridge.exposeInMainWorld('mainframe', api);
