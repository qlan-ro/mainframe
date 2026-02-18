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

declare global {
  interface Window {
    mainframe: MainframeAPI;
  }
}
