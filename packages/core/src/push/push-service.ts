import { createChildLogger } from '../logger.js';

const logger = createChildLogger('push');
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, unknown>;
  priority: 'default' | 'high';
}

interface RegisteredDevice {
  pushToken: string;
  connected: boolean;
}

export class PushService {
  private devices = new Map<string, RegisteredDevice>();

  registerDevice(deviceId: string, pushToken: string): void {
    const existing = this.devices.get(deviceId);
    this.devices.set(deviceId, {
      pushToken,
      connected: existing?.connected ?? false,
    });
    logger.info({ deviceId }, 'push token registered');
  }

  unregisterDevice(deviceId: string): void {
    this.devices.delete(deviceId);
  }

  setDeviceConnected(deviceId: string, connected: boolean): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.connected = connected;
    }
  }

  isDeviceConnected(deviceId: string): boolean {
    return this.devices.get(deviceId)?.connected ?? false;
  }

  hasRegisteredDevices(): boolean {
    return this.devices.size > 0;
  }

  async sendPush(message: PushMessage): Promise<void> {
    const disconnectedTokens = Array.from(this.devices.values())
      .filter((d) => !d.connected)
      .map((d) => d.pushToken);

    if (disconnectedTokens.length === 0) return;

    const messages = disconnectedTokens.map((token) => ({
      to: token,
      title: message.title,
      body: message.body,
      data: message.data,
      priority: message.priority,
      sound: message.priority === 'high' ? 'default' : undefined,
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });

      if (!res.ok) {
        logger.error({ status: res.status }, 'expo push API error');
      }
    } catch (err) {
      logger.error({ err }, 'failed to send push notification');
    }
  }
}
