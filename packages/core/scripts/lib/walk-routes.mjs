// Enumerate the daemon's HTTP surface by importing every route factory the way
// createHttpServer (src/server/http.ts) mounts them, then walking the Express
// router stack. A Proxy stands in for every dependency: route factories only
// touch ctx inside handlers (never at registration time), so the Proxy lets us
// build real routers without a DB, ChatManager, etc.

/** A dependency stub that answers any property access or call with itself. */
function makeCtxProxy() {
  const handler = {
    get: () => proxy,
    apply: () => proxy,
    construct: () => proxy,
  };
  const proxy = new Proxy(function () {}, handler);
  return proxy;
}

/**
 * Factory registry — mirrors the mount list in src/server/http.ts, in order.
 * `module` is resolved relative to packages/core/scripts/lib.
 * Factories whose handlers live in composed sub-routers (git) are flattened by
 * the recursive walk below.
 */
const FACTORIES = [
  ['../../src/server/routes/auth.ts', 'authRoutes'],
  ['../../src/server/routes/device.ts', 'deviceRoutes'],
  ['../../src/server/routes/tunnel.ts', 'tunnelRoutes'],
  ['../../src/server/routes/projects.ts', 'projectRoutes'],
  ['../../src/server/routes/chats.ts', 'chatRoutes'],
  ['../../src/server/routes/chat-commands.ts', 'chatCommandRoutes'],
  ['../../src/server/routes/files.ts', 'fileRoutes'],
  ['../../src/server/routes/search.ts', 'contentSearchRoutes'],
  ['../../src/server/routes/git.ts', 'gitRoutes'],
  ['../../src/server/routes/suggestions.ts', 'suggestionRoutes'],
  ['../../src/server/routes/context.ts', 'contextRoutes'],
  ['../../src/server/routes/attachments.ts', 'attachmentRoutes'],
  ['../../src/server/routes/adapters.ts', 'adapterRoutes'],
  ['../../src/server/routes/commands.ts', 'commandRoutes'],
  ['../../src/server/routes/skills.ts', 'skillRoutes'],
  ['../../src/server/routes/agents.ts', 'agentRoutes'],
  ['../../src/server/routes/settings.ts', 'settingRoutes'],
  ['../../src/server/routes/launch.ts', 'launchRoutes'],
  ['../../src/server/routes/external-sessions.ts', 'externalSessionRoutes'],
  ['../../src/server/routes/worktree.ts', 'worktreeRoutes'],
  ['../../src/server/routes/tags.ts', 'tagRoutes'],
  ['../../src/server/routes/workflows.ts', 'workflowRoutes'],
  ['../../src/server/routes/workflow-admin.ts', 'workflowAdminRoutes'],
  ['../../src/server/routes/background-tasks.ts', 'backgroundTaskRoutes'],
  ['../../src/server/routes/lsp-routes.ts', 'lspRoutes'],
];

function walkStack(router, prefix, out) {
  for (const layer of router.stack ?? []) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
      for (const method of methods) {
        out.push({ method: method.toUpperCase(), path: prefix + layer.route.path });
      }
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      walkStack(layer.handle, prefix, out);
    }
  }
}

/**
 * Import + walk every factory. Returns a de-duplicated, method+path-sorted list
 * of { method, path }. Also returns the mount-only entries the router stack
 * can't reveal (the /health handler defined inline in http.ts and the dynamic
 * /api/plugins parent mount).
 */
export async function enumerateRoutes() {
  const ctx = makeCtxProxy();
  const routes = [];
  for (const [modPath, exportName] of FACTORIES) {
    const mod = await import(new URL(modPath, import.meta.url).href);
    const factory = mod[exportName];
    if (typeof factory !== 'function') {
      throw new Error(`Factory ${exportName} not found in ${modPath}`);
    }
    walkStack(factory(ctx), '', routes);
  }

  // Inline handler in http.ts, not a factory.
  routes.push({ method: 'GET', path: '/health' });

  const seen = new Set();
  const unique = [];
  for (const r of routes) {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(r);
  }
  unique.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
  return unique;
}

/** The dynamic plugin mount — documented, not walkable (sub-routers register at runtime). */
export const PLUGIN_MOUNT = {
  method: '*',
  path: '/api/plugins/*',
  auth: { requirement: 'bearer', loopbackBypass: true },
  request: null,
  response: { note: 'per-plugin; PluginManager.router owns a listing route plus one sub-router per plugin' },
  statusCodes: [],
  confidence: 'low',
  notes:
    'Dynamic mount (src/server/http.ts: app.use("/api/plugins", pluginManager.router)). Builtin plugins (todos) ' +
    'register sub-routes at runtime; not enumerable from a static router walk. Rust v1 keeps builtins behind this surface.',
};
