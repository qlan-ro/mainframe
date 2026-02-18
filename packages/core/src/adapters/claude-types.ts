import type { ChildProcess } from 'node:child_process';
import type { AdapterProcess } from '@mainframe/types';
import type { BaseAdapter } from './base.js';

export interface ClaudeProcess extends AdapterProcess {
  child: ChildProcess;
  buffer: string;
  lastAssistantUsage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export type ClaudeEventEmitter = Pick<BaseAdapter, 'emit'>;
