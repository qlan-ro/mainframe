export type LaunchProcessStatus = 'stopped' | 'starting' | 'running' | 'failed';

export interface LaunchConfiguration {
  name: string;
  runtimeExecutable: string;
  runtimeArgs: string[];
  port: number | null;
  url: string | null;
  preview?: boolean;
}

export interface LaunchConfig {
  version: string;
  configurations: LaunchConfiguration[];
}
