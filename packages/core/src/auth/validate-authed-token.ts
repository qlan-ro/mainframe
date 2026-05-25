import { validateToken, type TokenPayload } from './token.js';
import type { DevicesRepository } from '../db/devices.js';

export function validateAuthedToken(
  secret: string,
  token: string,
  devicesRepo: DevicesRepository,
): TokenPayload | null {
  const payload = validateToken(secret, token);
  if (!payload) return null;

  const device = devicesRepo.findByDeviceId(payload.deviceId);
  if (!device) return null;

  const presentedEpoch = payload.epoch ?? -1;
  if (presentedEpoch !== device.authEpoch) return null;

  return payload;
}
