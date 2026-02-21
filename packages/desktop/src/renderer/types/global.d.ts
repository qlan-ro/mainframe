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

declare global {
  interface Window {
    mainframe: MainframeAPI;
  }
}
