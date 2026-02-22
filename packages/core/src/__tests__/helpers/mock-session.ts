import type {
  AdapterSession,
  AdapterProcess,
  SessionSpawnOptions,
  SessionSink,
  ControlResponse,
  SkillFileEntry,
  ContextFile,
  ChatMessage,
  MessageContent,
  MessageMetadata,
  ControlRequest,
  SessionResult,
} from '@mainframe/types';

export class MockBaseSession implements AdapterSession {
  readonly id: string;
  readonly adapterId: string;
  readonly projectPath: string;
  protected sink: SessionSink | undefined;
  private spawned = false;

  constructor(id = 'mock-session', adapterId = 'mock', projectPath = '/mock/project') {
    this.id = id;
    this.adapterId = adapterId;
    this.projectPath = projectPath;
  }

  get isSpawned(): boolean {
    return this.spawned;
  }

  async spawn(_options?: SessionSpawnOptions, sink?: SessionSink): Promise<AdapterProcess> {
    this.spawned = true;
    this.sink = sink;
    return {
      id: this.id,
      adapterId: this.adapterId,
      chatId: this.id,
      pid: 1234,
      status: 'ready',
      projectPath: this.projectPath,
    };
  }

  async kill(): Promise<void> {
    this.spawned = false;
  }

  getProcessInfo(): AdapterProcess | null {
    if (!this.spawned) return null;
    return {
      id: this.id,
      adapterId: this.adapterId,
      chatId: this.id,
      pid: 1234,
      status: 'ready',
      projectPath: this.projectPath,
    };
  }

  async sendMessage(_message: string, _images?: { mediaType: string; data: string }[]): Promise<void> {}
  async respondToPermission(_response: ControlResponse): Promise<void> {}
  async interrupt(): Promise<void> {}
  async setModel(_model: string): Promise<void> {}
  async setPermissionMode(_mode: string): Promise<void> {}
  async sendCommand(_command: string, _args?: string): Promise<void> {}

  getContextFiles(): { global: ContextFile[]; project: ContextFile[] } {
    return { global: [], project: [] };
  }

  async loadHistory(): Promise<ChatMessage[]> {
    return [];
  }

  async extractPlanFiles(): Promise<string[]> {
    return [];
  }

  async extractSkillFiles(): Promise<SkillFileEntry[]> {
    return [];
  }

  // ── Test simulation helpers ───────────────────────────────────────────────

  simulateInit(claudeSessionId: string): void {
    this.sink?.onInit(claudeSessionId);
  }

  simulateMessage(content: MessageContent[], metadata?: MessageMetadata): void {
    this.sink?.onMessage(content, metadata);
  }

  simulateToolResult(content: MessageContent[]): void {
    this.sink?.onToolResult(content);
  }

  simulatePermission(request: ControlRequest): void {
    this.sink?.onPermission(request);
  }

  simulateResult(data: SessionResult): void {
    this.sink?.onResult(data);
  }

  simulateExit(code: number | null): void {
    this.sink?.onExit(code);
  }

  simulateError(error: Error): void {
    this.sink?.onError(error);
  }

  simulateCompact(): void {
    this.sink?.onCompact();
  }

  simulatePlanFile(filePath: string): void {
    this.sink?.onPlanFile(filePath);
  }

  simulateSkillFile(entry: SkillFileEntry): void {
    this.sink?.onSkillFile(entry);
  }
}
