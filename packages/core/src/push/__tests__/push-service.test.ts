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
});
