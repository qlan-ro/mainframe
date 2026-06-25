/**
 * launch REST client — behavior tests.
 *
 * Behaviors covered:
 *  - fetchLaunchStatuses GETs the status route with an optional chatId query param
 *  - fetchLaunchConfigs  GETs the configs route
 *  - startLaunchConfig  POSTs to the encoded start route (special chars in name)
 *  - stopLaunchConfig   POSTs to the encoded stop route
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const request = vi.fn();
const requestEmpty = vi.fn();

vi.mock('@/lib/api/http', () => ({
  apiBase: (p: number) => `http://127.0.0.1:${p}`,
  request: (...a: unknown[]) => request(...a),
  requestEmpty: (...a: unknown[]) => requestEmpty(...a),
}));

import { fetchLaunchConfigs, fetchLaunchStatuses, startLaunchConfig, stopLaunchConfig } from '../launch';

beforeEach(() => {
  request.mockReset();
  requestEmpty.mockReset();
});

// ---------------------------------------------------------------------------
// fetchLaunchStatuses
// ---------------------------------------------------------------------------

describe('fetchLaunchStatuses', () => {
  it('GETs the status route with chatId query when provided', async () => {
    request.mockResolvedValue({ statuses: {}, tunnelUrls: {}, effectivePath: '/p' });
    const r = await fetchLaunchStatuses(31415, 'proj-1', 'chat-9');
    expect(request).toHaveBeenCalledWith(
      'GET',
      'http://127.0.0.1:31415/api/projects/proj-1/launch/status?chatId=chat-9',
    );
    expect(r.effectivePath).toBe('/p');
  });

  it('GETs the status route without query when chatId is omitted', async () => {
    request.mockResolvedValue({ statuses: {}, tunnelUrls: {}, effectivePath: '/q' });
    await fetchLaunchStatuses(31415, 'proj-2');
    expect(request).toHaveBeenCalledWith('GET', 'http://127.0.0.1:31415/api/projects/proj-2/launch/status');
  });
});

// ---------------------------------------------------------------------------
// fetchLaunchConfigs
// ---------------------------------------------------------------------------

describe('fetchLaunchConfigs', () => {
  it('GETs the configs route and returns the array', async () => {
    const configs = [{ name: 'dev', runtimeExecutable: 'node', runtimeArgs: [], port: 3000, url: null }];
    request.mockResolvedValue(configs);
    const r = await fetchLaunchConfigs(31415, 'proj-1');
    expect(request).toHaveBeenCalledWith('GET', 'http://127.0.0.1:31415/api/projects/proj-1/launch/configs');
    expect(r).toEqual(configs);
  });
});

// ---------------------------------------------------------------------------
// startLaunchConfig
// ---------------------------------------------------------------------------

describe('startLaunchConfig', () => {
  it('POSTs the encoded config name to the start route', async () => {
    requestEmpty.mockResolvedValue(undefined);
    await startLaunchConfig(31415, 'proj-1', 'dev server');
    expect(requestEmpty).toHaveBeenCalledWith(
      'POST',
      'http://127.0.0.1:31415/api/projects/proj-1/launch/dev%20server/start',
    );
  });

  it('appends chatId query when provided', async () => {
    requestEmpty.mockResolvedValue(undefined);
    await startLaunchConfig(31415, 'proj-1', 'dev', 'chat-5');
    expect(requestEmpty).toHaveBeenCalledWith(
      'POST',
      'http://127.0.0.1:31415/api/projects/proj-1/launch/dev/start?chatId=chat-5',
    );
  });
});

// ---------------------------------------------------------------------------
// stopLaunchConfig
// ---------------------------------------------------------------------------

describe('stopLaunchConfig', () => {
  it('POSTs the encoded config name to the stop route', async () => {
    requestEmpty.mockResolvedValue(undefined);
    await stopLaunchConfig(31415, 'proj-1', 'dev server');
    expect(requestEmpty).toHaveBeenCalledWith(
      'POST',
      'http://127.0.0.1:31415/api/projects/proj-1/launch/dev%20server/stop',
    );
  });
});
