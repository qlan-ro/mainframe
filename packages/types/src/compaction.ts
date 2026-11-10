export interface CompactionMetadata {
  origin: 'idle';
  requestId: string;
  sessionGeneration: string;
  commandUuid?: string;
  vendorId?: string;
  beforeTokens?: number;
  afterTokens?: number;
}
