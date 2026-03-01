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
  log: (level: string, module: string, message: string, data?: unknown) => void;
}

declare global {
  interface Window {
    mainframe: MainframeAPI;
  }
}
