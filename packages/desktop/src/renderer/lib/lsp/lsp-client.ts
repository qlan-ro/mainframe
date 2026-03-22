import * as monaco from 'monaco-editor';

interface LspClientEntry {
  ws: WebSocket;
  requestId: number;
  pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>;
  disposables: monaco.IDisposable[];
}

function makeKey(projectId: string, language: string): string {
  return `${projectId}:${language}`;
}

function getDaemonWsUrl(): string {
  const env = (import.meta as { env?: Record<string, string> }).env ?? {};
  const host = env['VITE_DAEMON_HOST'] ?? '127.0.0.1';
  const port = env['VITE_DAEMON_WS_PORT'] ?? '31415';
  return `ws://${host}:${port}`;
}

/**
 * Minimal LSP client using raw WebSocket + JSON-RPC.
 * Registers definition/reference/hover providers directly on monaco-editor.
 */
export class LspClientManager {
  private readonly clients = new Map<string, LspClientEntry>();
  private readonly pending = new Map<string, Promise<void>>();

  hasClient(projectId: string, language: string): boolean {
    return this.clients.has(makeKey(projectId, language));
  }

  async ensureClient(projectId: string, language: string, projectPath: string): Promise<void> {
    const key = makeKey(projectId, language);
    if (this.clients.has(key)) return;

    const inflight = this.pending.get(key);
    if (inflight) return inflight;

    const promise = this.startClient(key, language, projectId, projectPath);
    this.pending.set(key, promise);
    try {
      await promise;
    } finally {
      this.pending.delete(key);
    }
  }

  private async startClient(key: string, language: string, projectId: string, projectPath: string): Promise<void> {
    if (this.clients.has(key)) return;

    const wsUrl = `${getDaemonWsUrl()}/lsp/${projectId}/${language}`;
    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`WebSocket error connecting to ${wsUrl}`));
    });

    const entry: LspClientEntry = { ws, requestId: 1, pending: new Map(), disposables: [] };
    this.clients.set(key, entry);

    ws.onmessage = (ev) => this.handleMessage(entry, ev);
    ws.onclose = () => this.removeEntry(key);
    ws.onerror = () => this.removeEntry(key);

    // Initialize LSP
    const initResult = await this.sendRequest(entry, 'initialize', {
      processId: null,
      capabilities: {
        textDocument: {
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          hover: { contentFormat: ['plaintext', 'markdown'], dynamicRegistration: false },
        },
      },
      rootUri: `file://${projectPath}`,
      workspaceFolders: [{ uri: `file://${projectPath}`, name: projectPath.split('/').pop() ?? '' }],
    });

    // Send initialized notification
    this.sendNotification(entry, 'initialized', {});

    // Register Monaco providers
    const caps = initResult?.capabilities;
    if (caps?.definitionProvider) {
      entry.disposables.push(
        monaco.languages.registerDefinitionProvider(language, {
          provideDefinition: (model, position) => this.provideDefinition(entry, model, position),
        }),
      );
    }
    if (caps?.referencesProvider) {
      entry.disposables.push(
        monaco.languages.registerReferenceProvider(language, {
          provideReferences: (model, position, context) => this.provideReferences(entry, model, position, context),
        }),
      );
    }
    if (caps?.hoverProvider) {
      entry.disposables.push(
        monaco.languages.registerHoverProvider(language, {
          provideHover: (model, position) => this.provideHover(entry, model, position),
        }),
      );
    }
  }

  private async provideDefinition(
    entry: LspClientEntry,
    model: monaco.editor.ITextModel,
    position: monaco.Position,
  ): Promise<monaco.languages.Definition | null> {
    // Send didOpen if not already sent
    this.ensureDocumentOpen(entry, model);

    const result = await this.sendRequest(entry, 'textDocument/definition', {
      textDocument: { uri: model.uri.toString() },
      position: { line: position.lineNumber - 1, character: position.column - 1 },
    });

    return this.toMonacoLocations(result);
  }

  private async provideReferences(
    entry: LspClientEntry,
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    context: monaco.languages.ReferenceContext,
  ): Promise<monaco.languages.Location[] | null> {
    this.ensureDocumentOpen(entry, model);

    const result = await this.sendRequest(entry, 'textDocument/references', {
      textDocument: { uri: model.uri.toString() },
      position: { line: position.lineNumber - 1, character: position.column - 1 },
      context: { includeDeclaration: context.includeDeclaration },
    });

    return this.toMonacoLocations(result) as monaco.languages.Location[] | null;
  }

  private async provideHover(
    entry: LspClientEntry,
    model: monaco.editor.ITextModel,
    position: monaco.Position,
  ): Promise<monaco.languages.Hover | null> {
    this.ensureDocumentOpen(entry, model);

    const result = await this.sendRequest(entry, 'textDocument/hover', {
      textDocument: { uri: model.uri.toString() },
      position: { line: position.lineNumber - 1, character: position.column - 1 },
    });

    if (!result?.contents) return null;

    const contents = Array.isArray(result.contents)
      ? result.contents.map((c: any) => ({ value: typeof c === 'string' ? c : c.value }))
      : [{ value: typeof result.contents === 'string' ? result.contents : result.contents.value }];

    return { contents };
  }

  private openedUris = new Set<string>();

  private ensureDocumentOpen(entry: LspClientEntry, model: monaco.editor.ITextModel): void {
    const uri = model.uri.toString();
    if (this.openedUris.has(uri)) return;
    this.openedUris.add(uri);

    this.sendNotification(entry, 'textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: model.getLanguageId(),
        version: model.getVersionId(),
        text: model.getValue(),
      },
    });
  }

  private toMonacoLocations(result: any): monaco.languages.Location[] | null {
    if (!result) return null;
    const items = Array.isArray(result) ? result : [result];
    return items.map((loc: any) => ({
      uri: monaco.Uri.parse(loc.uri),
      range: new monaco.Range(
        loc.range.start.line + 1,
        loc.range.start.character + 1,
        loc.range.end.line + 1,
        loc.range.end.character + 1,
      ),
    }));
  }

  private sendRequest(entry: LspClientEntry, method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = entry.requestId++;
      entry.pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      entry.ws.send(msg);
    });
  }

  private sendNotification(entry: LspClientEntry, method: string, params: any): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    entry.ws.send(msg);
  }

  private handleMessage(entry: LspClientEntry, ev: MessageEvent): void {
    try {
      const data = JSON.parse(ev.data as string);
      if (data.id != null && entry.pending.has(data.id)) {
        const handler = entry.pending.get(data.id)!;
        entry.pending.delete(data.id);
        if (data.error) {
          handler.reject(new Error(data.error.message));
        } else {
          handler.resolve(data.result);
        }
      }
    } catch {
      // ignore malformed messages
    }
  }

  disposeClient(projectId: string, language: string): void {
    this.removeEntry(makeKey(projectId, language));
  }

  disposeAll(): void {
    for (const key of [...this.clients.keys()]) {
      this.removeEntry(key);
    }
  }

  private removeEntry(key: string): void {
    const entry = this.clients.get(key);
    if (!entry) return;
    this.clients.delete(key);
    for (const d of entry.disposables) d.dispose();
    try {
      if (entry.ws.readyState === WebSocket.OPEN) entry.ws.close();
    } catch {
      /* already closed */
    }
  }
}
