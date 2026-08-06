import { describe, expect, it } from 'vitest';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';
import { deriveLaunchRows } from '../launch-view';

const config = (name: string, over: Partial<LaunchConfiguration> = {}): LaunchConfiguration => ({
  name,
  runtimeExecutable: 'pnpm',
  runtimeArgs: ['dev'],
  port: null,
  url: null,
  ...over,
});

const web = config('Web', { preview: true, port: 5173 });
const api = config('API');

describe('deriveLaunchRows', () => {
  it('returns nothing when the project has no launch configurations', () => {
    expect(deriveLaunchRows([], {}, null)).toEqual([]);
  });

  it('reads an unlisted config as stopped and not live', () => {
    const rows = deriveLaunchRows([api], {}, null);
    expect(rows).toEqual([{ config: api, name: 'API', status: 'stopped', live: false, selected: false }]);
  });

  it('carries the whole config object, not just its name', () => {
    const [row] = deriveLaunchRows([web], {}, null);
    expect(row?.config).toBe(web);
  });

  it('keeps `starting` distinct from `running` while still marking it live', () => {
    const rows = deriveLaunchRows([web, api], { Web: 'starting', API: 'running' }, null);
    expect(rows.map((r) => r.status)).toEqual(['starting', 'running']);
    expect(rows.map((r) => r.live)).toEqual([true, true]);
  });

  it('treats `failed` as not live', () => {
    const [row] = deriveLaunchRows([api], { API: 'failed' }, null);
    expect(row).toMatchObject({ status: 'failed', live: false });
  });

  it('marks the selected config', () => {
    const rows = deriveLaunchRows([web, api], {}, 'API');
    expect(rows.map((r) => r.selected)).toEqual([false, true]);
  });

  it('marks nothing selected when the stored name is not in this project', () => {
    const rows = deriveLaunchRows([web, api], {}, 'Gone');
    expect(rows.map((r) => r.selected)).toEqual([false, false]);
  });

  it('preserves the configuration order', () => {
    const rows = deriveLaunchRows([web, api], { API: 'running' }, 'API');
    expect(rows.map((r) => r.name)).toEqual(['Web', 'API']);
  });
});
