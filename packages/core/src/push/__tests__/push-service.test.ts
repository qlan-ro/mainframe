import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PushService } from '../push-service.js';

describe('PushService', () => {
  let service: PushService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    service = new PushService();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  });

  afterEach(() => {
    service.dispose();
    global.fetch = originalFetch;
  });

  it('registers a push token', () => {
    service.registerDevice('device-1', 'ExponentPushToken[xxx]');
    expect(service.hasRegisteredDevices()).toBe(true);
  });

  it('tracks connected devices', () => {
    service.registerDevice('device-1', 'ExponentPushToken[xxx]');
    service.setDeviceConnected('device-1', true);
    expect(service.isDeviceConnected('device-1')).toBe(true);

    service.setDeviceConnected('device-1', false);
    expect(service.isDeviceConnected('device-1')).toBe(false);
  });

  it('sends push notification to disconnected devices only', async () => {
    service.registerDevice('device-1', 'ExponentPushToken[aaa]');
    service.registerDevice('device-2', 'ExponentPushToken[bbb]');
    service.setDeviceConnected('device-1', true);
    service.setDeviceConnected('device-2', false);

    await service.sendPush({
      title: 'Permission Required',
      body: 'Claude wants to run: npm test',
      data: { chatId: 'chat-1', type: 'permission' },
      priority: 'high',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body);
    expect(body[0].to).toBe('ExponentPushToken[bbb]');
  });

  it('skips push when all devices are connected', async () => {
    service.registerDevice('device-1', 'ExponentPushToken[aaa]');
    service.setDeviceConnected('device-1', true);

    await service.sendPush({
      title: 'Test',
      body: 'Test',
      data: {},
      priority: 'default',
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('unregisters a device', () => {
    service.registerDevice('device-1', 'ExponentPushToken[xxx]');
    expect(service.hasRegisteredDevices()).toBe(true);
    service.unregisterDevice('device-1');
    expect(service.hasRegisteredDevices()).toBe(false);
  });

  it('skips push when desktop is active', async () => {
    service.registerDevice('device-1', 'ExponentPushToken[aaa]');
    service.setDesktopActive(true);

    await service.sendPush({
      title: 'Test',
      body: 'Test',
      data: {},
      priority: 'default',
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends push when desktop is idle', async () => {
    service.registerDevice('device-1', 'ExponentPushToken[aaa]');
    service.setDesktopActive(true);
    service.setDesktopActive(false);

    await service.sendPush({
      title: 'Test',
      body: 'Test',
      data: {},
      priority: 'default',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('expires desktop-active state after staleness timeout', async () => {
    vi.useFakeTimers();
    service.registerDevice('device-1', 'ExponentPushToken[aaa]');
    service.setDesktopActive(true);

    // Advance past 6-minute staleness timeout
    vi.advanceTimersByTime(6 * 60 * 1000 + 100);

    await service.sendPush({
      title: 'Test',
      body: 'Test',
      data: {},
      priority: 'default',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('resets staleness timer on repeated setDesktopActive(true)', async () => {
    vi.useFakeTimers();
    service.registerDevice('device-1', 'ExponentPushToken[aaa]');
    service.setDesktopActive(true);

    // Advance 5 minutes, then re-report active
    vi.advanceTimersByTime(5 * 60 * 1000);
    service.setDesktopActive(true);

    // Advance another 5 minutes (10 total, but only 5 since last active)
    vi.advanceTimersByTime(5 * 60 * 1000);

    await service.sendPush({
      title: 'Test',
      body: 'Test',
      data: {},
      priority: 'default',
    });

    // Should still be suppressed — timer was reset
    expect(fetch).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
