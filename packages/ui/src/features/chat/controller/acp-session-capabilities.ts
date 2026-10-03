import type { AcpSessionAttachmentHost, AcpSessionClientPort } from './acp-session-attachment-types';

export class AcpSessionCapabilities {
  private client: AcpSessionClientPort | null = null;
  private unsubscribe: (() => void) | null = null;
  private generation = 0;
  private authoritative = false;
  constructor(private readonly host: Pick<AcpSessionAttachmentHost, 'dispatch' | 'isDisposed'>) {}
  bind(client: AcpSessionClientPort): void {
    if (this.client !== client) {
      this.dispose();
      this.client = client;
      const generation = this.generation;
      this.unsubscribe =
        client.onCapabilitiesChanged?.(() => {
          if (this.client === client && this.generation === generation) this.refresh(client);
        }) ?? null;
    }
    this.refresh(client);
  }
  dispose(): void {
    this.generation += 1;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.client = null;
  }
  private refresh(client: AcpSessionClientPort): void {
    if (this.host.isDisposed()) return;
    const authoritative = client.mainframeCapabilities?.authoritativeItemStreaming === true;
    if (authoritative === this.authoritative) return;
    this.authoritative = authoritative;
    this.host.dispatch({ type: 'capabilities.updated', authoritativeItemStreaming: authoritative });
  }
}
