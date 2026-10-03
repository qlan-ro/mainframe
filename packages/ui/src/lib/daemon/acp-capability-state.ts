import {
  MAINFRAME_META_NAMESPACE,
  MainframeCapabilitiesSchema,
  type InitializeResponse,
  type MainframeCapabilities,
} from '@qlan-ro/mainframe-types';

export type CapabilitiesListener = (capabilities: MainframeCapabilities | null) => void;
export function parseCapabilities(response: InitializeResponse): MainframeCapabilities | null {
  const raw = response._meta?.[MAINFRAME_META_NAMESPACE];
  if (raw === undefined) return null;
  const parsed = MainframeCapabilitiesSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
export class AcpCapabilityState {
  private snapshot: MainframeCapabilities | null = null;
  private readonly listeners = new Set<CapabilitiesListener>();
  get current(): MainframeCapabilities | null {
    return this.snapshot;
  }
  replace(capabilities: MainframeCapabilities | null): void {
    this.snapshot = capabilities;
    this.listeners.forEach((listener) => listener(capabilities));
  }
  subscribe(listener: CapabilitiesListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
