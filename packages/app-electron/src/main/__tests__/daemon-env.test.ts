import { describe, expect, it } from 'vitest';

import { buildDaemonEnv } from '../daemon-env.js';

describe('buildDaemonEnv', () => {
  it('preserves shell PATH without letting shell daemon settings override the app', () => {
    const env = buildDaemonEnv(
      {
        DAEMON_PORT: '31415',
        MAINFRAME_DATA_DIR: '/tmp/mainframe-app-data',
        LOG_LEVEL: 'debug',
        NODE_ENV: 'development',
        VITE_DAEMON_HTTP_PORT: '31415',
        VITE_DAEMON_WS_PORT: '31415',
      },
      {
        PATH: '/opt/homebrew/bin:/usr/bin:/bin',
        DAEMON_PORT: '31735',
        MAINFRAME_DATA_DIR: '/Users/dev/.mainframe_dev',
        NODE_ENV: 'development',
        VITE_DAEMON_HTTP_PORT: '31735',
        VITE_DAEMON_WS_PORT: '31735',
      },
    );

    expect(env.PATH).toBe('/opt/homebrew/bin:/usr/bin:/bin');
    expect(env.DAEMON_PORT).toBe('31415');
    expect(env.VITE_DAEMON_HTTP_PORT).toBe('31415');
    expect(env.VITE_DAEMON_WS_PORT).toBe('31415');
    expect(env.MAINFRAME_DATA_DIR).toBe('/tmp/mainframe-app-data');
    expect(env.LOG_LEVEL).toBe('debug');
    expect(env.NODE_ENV).toBe('production');
  });
});
