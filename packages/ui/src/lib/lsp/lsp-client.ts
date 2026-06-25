/**
 * Editor-agnostic LSP client for app-tauri.
 *
 * Transport: raw WebSocket + JSON-RPC 2.0 to the daemon's LSP proxy at
 * `ws://127.0.0.1:<port>/lsp/<projectId>/<language>[?chatId=…]`.
 *
 * This module has ZERO Monaco / editor imports. Phase 2/3 wire the CM6 adapters
 * on top of the `LspProviders` interface exposed here.
 *
 * Port of packages/app-electron/src/renderer/lib/lsp/lsp-client.ts
 * Changes:
 *   - Deleted: monaco.languages.register{Definition,Reference,Hover}Provider
 *   - Deleted: toMonacoLocations (Monaco Range/Uri mapper)
 *   - Added:   LspProviders interface (plain LSP types)
 *   - Changed: ensureDocumentOpen accepts a DocumentRef (path+text+languageId)
 *              instead of a Monaco ITextModel
 *   - Changed: port injected via constructor (from getDaemonPort), not env vars
 *   - Fixed:   removeEntry rejects all in-flight pending requests
 *   - Fixed:   silent catches now log with console.warn('[lsp] ...')
 *   - Fixed(#13a): client registered AFTER initialize/initialized completes;
 *              provider calls return [] while init is in-flight (no protocol violation)
 *   - Fixed(#13b): server→client requests (id+method) get a minimal JSON-RPC
 *              response so the server doesn't block waiting for a reply
 *   - Fixed(#13c): sendRequest and connect have a configurable timeout so a
 *              hung server never pends forever; timed-out requests are removed
 *              from pending
 *   - Fixed(R4): worktree-aware — chatId threaded through WS URL + HTTP calls;
 *              file:// URI base resolved from daemon (resolvePath) not a
 *              client-supplied projectPath prop.
 */

import { resolvePath } from '../api/files';

// ---------------------------------------------------------------------------
// Plain LSP types (no editor dependency)
// ---------------------------------------------------------------------------

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface LspMarkupContent {
  kind: 'plaintext' | 'markdown';
  value: string;
}

export interface LspHover {
  contents: LspMarkupContent[];
  range?: LspRange;
}

export interface LspSymbol {
  /** Symbol name (e.g. "useLayoutStore"). */
  name: string;
  /** LSP SymbolKind enum number. */
  kind: number;
  /** Project-relative path (e.g. "src/store/layout.ts"). */
  path: string;
  /** 0-based start line of the symbol. */
  line: number;
}

/** The seam Phase 2/3 (CM6 adapters) consume — no editor types cross here. */
export interface LspProviders {
  getDefinition(
    projectId: string,
    language: string,
    opts: { filePath: string; position: LspPosition },
  ): Promise<LspLocation[]>;

  getReferences(
    projectId: string,
    language: string,
    opts: { filePath: string; position: LspPosition; includeDeclaration?: boolean },
  ): Promise<LspLocation[]>;

  getHover(
    projectId: string,
    language: string,
    opts: { filePath: string; position: LspPosition },
  ): Promise<LspHover | null>;

  getWorkspaceSymbols(projectId: string, language: string, query: string): Promise<LspSymbol[]>;
}

// ---------------------------------------------------------------------------
// DocumentRef — path-based doc descriptor (replaces Monaco ITextModel)
// ---------------------------------------------------------------------------

export interface DocumentRef {
  /** Relative path from project root (e.g. "src/index.ts"). */
  filePath: string;
  text: string;
  languageId: string;
  version: number;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface LspClientManagerOptions {
  /**
   * Timeout in milliseconds for sendRequest. Defaults to 15 000 ms.
   * Also used as the connect (WebSocket open + initialize) timeout.
   */
  requestTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface LspClientEntry {
  ws: WebSocket;
  /** Worktree-or-project absolute base resolved via daemon's paths/resolve endpoint. */
  resolvedBase: string;
  /** Optional chatId — carried in HTTP calls for worktree-scoped content. */
  chatId: string | undefined;
  requestId: number;
  pending: Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >;
  /** True only after the `initialized` notification has been sent. */
  ready: boolean;
  /** URIs this client has already sent didOpen for (per-client, not global). */
  openedUris: Set<string>;
}

function makeKey(projectId: string, language: string): string {
  return `${projectId}:${language}`;
}

async function discoverWorkspaceFolders(
  projectId: string,
  resolvedBase: string,
  port: number,
  chatId: string | undefined,
): Promise<{ uri: string; name: string }[]> {
  const base = `http://127.0.0.1:${port}`;
  const qs = new URLSearchParams({ q: 'tsconfig.json', limit: '20' });
  if (chatId) qs.set('chatId', chatId);
  try {
    const res = await fetch(`${base}/api/projects/${projectId}/search/files?${qs}`);
    const envelope = (await res.json()) as {
      success: boolean;
      data?: { path: string; type: string }[];
    };
    const files = envelope.success && envelope.data ? envelope.data : [];
    const dirs = new Set<string>();
    for (const f of files) {
      if (f.type !== 'file' || !f.path.endsWith('tsconfig.json')) continue;
      const dir = f.path.substring(0, f.path.lastIndexOf('/'));
      if (dir) dirs.add(dir);
    }
    if (dirs.size === 0) {
      return [{ uri: `file://${resolvedBase}`, name: resolvedBase.split('/').pop() ?? '' }];
    }
    return [...dirs].map((d) => ({ uri: `file://${resolvedBase}/${d}`, name: d.split('/').pop() ?? d }));
  } catch (err) {
    console.warn('[lsp] discoverWorkspaceFolders failed', err);
    return [{ uri: `file://${resolvedBase}`, name: resolvedBase.split('/').pop() ?? '' }];
  }
}

// ---------------------------------------------------------------------------
// LspClientManager
// ---------------------------------------------------------------------------

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export class LspClientManager implements LspProviders {
  private readonly clients = new Map<string, LspClientEntry>();
  private readonly connecting = new Map<string, Promise<void>>();
  private readonly port: number;
  private readonly requestTimeoutMs: number;

  constructor(port: number, opts: LspClientManagerOptions = {}) {
    this.port = port;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  hasClient(projectId: string, language: string): boolean {
    return this.clients.has(makeKey(projectId, language));
  }

  async ensureClient(projectId: string, language: string, projectPath: string, chatId?: string): Promise<void> {
    const key = makeKey(projectId, language);
    if (this.clients.has(key)) return;

    const inflight = this.connecting.get(key);
    if (inflight) return inflight;

    const promise = this.startClient(key, language, projectId, projectPath, chatId);
    this.connecting.set(key, promise);
    try {
      await promise;
    } finally {
      this.connecting.delete(key);
    }
  }

  private async startClient(
    key: string,
    language: string,
    projectId: string,
    projectPath: string,
    chatId?: string,
  ): Promise<void> {
    if (this.clients.has(key)) return;

    const wsQs = chatId ? `?chatId=${encodeURIComponent(chatId)}` : '';
    const wsUrl = `ws://127.0.0.1:${this.port}/lsp/${projectId}/${language}${wsQs}`;
    const ws = new WebSocket(wsUrl);

    // Connect timeout: if the socket doesn't open within requestTimeoutMs, reject.
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.onopen = null;
        ws.onerror = null;
        reject(new Error(`[lsp] connect timeout for ${wsUrl}`));
      }, this.requestTimeoutMs);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`[lsp] WebSocket error connecting to ${wsUrl}`));
      };
    });

    // Resolve the effective base path from the daemon (worktree-aware).
    // Falls back to the caller-supplied projectPath if the call fails so a
    // network hiccup doesn't prevent LSP from starting at all.
    let resolvedBase = projectPath;
    try {
      const resolved = await resolvePath(this.port, projectId, '.', chatId);
      resolvedBase = resolved.absolute;
    } catch (err) {
      console.warn('[lsp] resolvePath failed, falling back to projectPath', err);
    }

    // Build the entry WITHOUT registering it in `this.clients` yet.
    // The entry is registered only after initialize+initialized succeeds (#13a).
    const entry: LspClientEntry = {
      ws,
      resolvedBase,
      chatId,
      requestId: 1,
      pending: new Map(),
      ready: false,
      openedUris: new Set(),
    };

    // Attach message/close/error handlers now so we don't miss server→client
    // requests that arrive during initialization.
    ws.onmessage = (ev) => this.handleMessage(entry, ev);
    ws.onclose = () => this.removeEntry(key);
    ws.onerror = () => this.removeEntry(key);

    const workspaceFolders = await discoverWorkspaceFolders(projectId, resolvedBase, this.port, chatId);

    try {
      await this.sendRequest(entry, 'initialize', {
        processId: null,
        capabilities: {
          textDocument: {
            definition: { dynamicRegistration: false },
            references: { dynamicRegistration: false },
            hover: { contentFormat: ['plaintext', 'markdown'], dynamicRegistration: false },
          },
          workspace: { workspaceFolders: true },
        },
        rootUri: `file://${resolvedBase}`,
        workspaceFolders,
      });
    } catch (err) {
      console.warn('[lsp] initialize failed', err);
      // Clean up the socket — it was never registered.
      try {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      } catch {
        /* already closed */
      }
      return;
    }

    this.sendNotification(entry, 'initialized', {});

    // Registration complete: mark ready and add to the public clients map.
    entry.ready = true;
    this.clients.set(key, entry);
  }

  // ---------------------------------------------------------------------------
  // LspProviders implementation
  // ---------------------------------------------------------------------------

  async getDefinition(
    projectId: string,
    language: string,
    opts: { filePath: string; position: LspPosition },
  ): Promise<LspLocation[]> {
    const entry = this.clients.get(makeKey(projectId, language));
    if (!entry || !entry.ready) return [];

    const uri = this.toLspUri(entry, opts.filePath);
    try {
      const result = await this.sendRequest(entry, 'textDocument/definition', {
        textDocument: { uri },
        position: opts.position,
      });
      return this.toLspLocations(result);
    } catch (err) {
      console.warn('[lsp] getDefinition failed', err);
      return [];
    }
  }

  async getReferences(
    projectId: string,
    language: string,
    opts: { filePath: string; position: LspPosition; includeDeclaration?: boolean },
  ): Promise<LspLocation[]> {
    const entry = this.clients.get(makeKey(projectId, language));
    if (!entry || !entry.ready) return [];

    const uri = this.toLspUri(entry, opts.filePath);
    try {
      const result = await this.sendRequest(entry, 'textDocument/references', {
        textDocument: { uri },
        position: opts.position,
        context: { includeDeclaration: opts.includeDeclaration ?? false },
      });
      return this.toLspLocations(result);
    } catch (err) {
      console.warn('[lsp] getReferences failed', err);
      return [];
    }
  }

  async getHover(
    projectId: string,
    language: string,
    opts: { filePath: string; position: LspPosition },
  ): Promise<LspHover | null> {
    const entry = this.clients.get(makeKey(projectId, language));
    if (!entry || !entry.ready) return null;

    const uri = this.toLspUri(entry, opts.filePath);
    try {
      const result = await this.sendRequest(entry, 'textDocument/hover', {
        textDocument: { uri },
        position: opts.position,
      });
      return this.toLspHover(result);
    } catch (err) {
      console.warn('[lsp] getHover failed', err);
      return null;
    }
  }

  async getWorkspaceSymbols(projectId: string, language: string, query: string): Promise<LspSymbol[]> {
    const entry = this.clients.get(makeKey(projectId, language));
    if (!entry || !entry.ready) return [];
    try {
      const result = await this.sendRequest(entry, 'workspace/symbol', { query });
      return this.toLspSymbols(entry, result);
    } catch (err) {
      console.warn('[lsp] getWorkspaceSymbols failed', err);
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Document management
  // ---------------------------------------------------------------------------

  /** Send textDocument/didOpen the first time a document is opened for an entry. */
  ensureDocumentOpen(projectId: string, language: string, doc: DocumentRef): void {
    const entry = this.clients.get(makeKey(projectId, language));
    if (!entry) return;

    const uri = this.toLspUri(entry, doc.filePath);
    if (entry.openedUris.has(uri)) return;
    entry.openedUris.add(uri);

    this.sendNotification(entry, 'textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: doc.languageId,
        version: doc.version,
        text: doc.text,
      },
    });
  }

  /**
   * Eagerly open a document by fetching its content from the daemon.
   * This primes tsserver before the user tries Go To Definition.
   * The URI base and chatId are taken from the entry (set at connect time) so
   * this call is worktree-aware without extra parameters.
   */
  preloadDocument(projectId: string, language: string, filePath: string): void {
    const entry = this.clients.get(makeKey(projectId, language));
    if (!entry) return;

    const uri = this.toLspUri(entry, filePath);
    if (entry.openedUris.has(uri)) return;
    entry.openedUris.add(uri);

    const base = `http://127.0.0.1:${this.port}`;
    const qs = new URLSearchParams({ path: filePath });
    if (entry.chatId) qs.set('chatId', entry.chatId);
    fetch(`${base}/api/projects/${projectId}/files?${qs}`)
      .then((r) => r.json())
      .then((envelope: unknown) => {
        const env = envelope as { success: boolean; data?: { content: string } };
        if (!env.success || !env.data) return;
        this.sendNotification(entry, 'textDocument/didOpen', {
          textDocument: { uri, languageId: language, version: 1, text: env.data.content },
        });
      })
      .catch((err: unknown) => console.warn('[lsp] preloadDocument failed', err));
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  disposeClient(projectId: string, language: string): void {
    this.removeEntry(makeKey(projectId, language));
  }

  disposeAll(): void {
    for (const key of [...this.clients.keys()]) {
      this.removeEntry(key);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private toLspUri(entry: LspClientEntry, filePath: string): string {
    // Already an absolute file:// URI
    if (filePath.startsWith('file://')) return filePath;
    // Relative path — prefix with the worktree-or-project resolved base
    const rel = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    return `file://${entry.resolvedBase}/${rel}`;
  }

  private fromLspUri(entry: LspClientEntry, uri: string): string {
    const prefix = `file://${entry.resolvedBase}/`;
    if (uri.startsWith(prefix)) return uri.slice(prefix.length);
    const bare = `file://${entry.resolvedBase}`;
    if (uri.startsWith(bare)) return uri.slice(bare.length).replace(/^\/+/, '');
    return uri.replace(/^file:\/\//, '');
  }

  private toLspSymbols(entry: LspClientEntry, result: unknown): LspSymbol[] {
    if (!Array.isArray(result)) return [];
    return (result as Array<{ name: string; kind: number; location: { uri: string; range: LspRange } }>).map((s) => ({
      name: s.name,
      kind: s.kind,
      path: this.fromLspUri(entry, s.location.uri),
      line: s.location.range.start.line,
    }));
  }

  private toLspLocations(result: unknown): LspLocation[] {
    if (!result) return [];
    const items = Array.isArray(result) ? result : [result];
    return (items as LspLocation[]).map((loc) => ({
      uri: loc.uri,
      range: {
        start: { line: loc.range.start.line, character: loc.range.start.character },
        end: { line: loc.range.end.line, character: loc.range.end.character },
      },
    }));
  }

  private toLspHover(result: unknown): LspHover | null {
    if (!result || typeof result !== 'object') return null;
    const r = result as { contents?: unknown };
    if (!r.contents) return null;
    const raw = r.contents;
    const items = Array.isArray(raw) ? raw : [raw];
    const contents = items.map((c: unknown) => {
      if (typeof c === 'string') return { kind: 'plaintext' as const, value: c };
      const obj = c as { kind?: string; value?: string };
      return {
        kind: (obj.kind === 'markdown' ? 'markdown' : 'plaintext') as 'plaintext' | 'markdown',
        value: obj.value ?? '',
      };
    });
    return { contents };
  }

  private sendRequest(entry: LspClientEntry, method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = entry.requestId++;

      const timer = setTimeout(() => {
        if (!entry.pending.has(id)) return;
        entry.pending.delete(id);
        reject(new Error(`[lsp] request timeout (method=${method}, id=${id})`));
      }, this.requestTimeoutMs);

      entry.pending.set(id, { resolve, reject, timer });

      try {
        entry.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        entry.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private sendNotification(entry: LspClientEntry, method: string, params: unknown): void {
    try {
      entry.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
    } catch (err) {
      console.warn(`[lsp] sendNotification(${method}) failed`, err);
    }
  }

  private handleMessage(entry: LspClientEntry, ev: MessageEvent): void {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(ev.data) as Record<string, unknown>;
    } catch (err) {
      console.warn('[lsp] handleMessage parse failed', err);
      return;
    }

    const id = data['id'];
    const method = data['method'];

    // Server→client REQUEST: has both an id and a method.
    // Reply with a minimal result so the server isn't blocked (#13b).
    if (id != null && method != null) {
      const resultValue = method === 'workspace/configuration' ? [] : null;
      try {
        entry.ws.send(JSON.stringify({ jsonrpc: '2.0', id, result: resultValue }));
      } catch (err) {
        console.warn(`[lsp] failed to reply to server request (method=${String(method)})`, err);
      }
      return;
    }

    // Client→server RESPONSE: has an id but no method.
    if (id != null && typeof id === 'number' && entry.pending.has(id)) {
      const handler = entry.pending.get(id)!;
      clearTimeout(handler.timer);
      entry.pending.delete(id);
      const error = data['error'] as { message: string } | undefined;
      if (error) {
        handler.reject(new Error(error.message));
      } else {
        handler.resolve(data['result']);
      }
      return;
    }

    // Server→client NOTIFICATION: no id — informational only, no response needed.
    // Log unknown ones at debug level for diagnostics.
    if (id == null && method != null) {
      // Expected notifications: textDocument/publishDiagnostics, window/logMessage, etc.
      return;
    }

    console.warn('[lsp] handleMessage: unrecognised message shape', { id, method });
  }

  private removeEntry(key: string): void {
    const entry = this.clients.get(key);
    if (!entry) return;
    this.clients.delete(key);

    // Reject all in-flight requests so callers don't hang forever.
    for (const [id, handler] of entry.pending) {
      clearTimeout(handler.timer);
      handler.reject(new Error(`[lsp] client disposed (key=${key}, pending id=${id})`));
    }
    entry.pending.clear();
    // The entry's openedUris set is discarded with the entry — no shared
    // global state to prune (each client tracks only its own opened docs).
    entry.openedUris.clear();

    try {
      if (entry.ws.readyState === WebSocket.OPEN) entry.ws.close();
    } catch {
      /* already closed — expected */
    }
  }
}
