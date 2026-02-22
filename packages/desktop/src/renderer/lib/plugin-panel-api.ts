export function buildPluginPanelAPI(pluginId: string) {
  return {
    async fetch(path: string, init?: RequestInit): Promise<Response> {
      const base = `http://localhost:31415/api/plugins/${pluginId}`;
      const url = path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
      return globalThis.fetch(url, init);
    },
  };
}
