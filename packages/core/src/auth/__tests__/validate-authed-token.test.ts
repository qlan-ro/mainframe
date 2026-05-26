import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DevicesRepository } from '../../db/devices.js';
import { generateToken } from '../token.js';
import { validateAuthedToken } from '../validate-authed-token.js';

describe('validateAuthedToken', () => {
  const SECRET = 'test-secret';
  let db: Database.Database;
  let devices: DevicesRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE devices (
        device_id   TEXT PRIMARY KEY,
        device_name TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        last_seen   TEXT,
        auth_epoch  INTEGER NOT NULL DEFAULT 0
      )
    `);
    devices = new DevicesRepository(db);
  });

  afterEach(() => db.close());

  it('returns payload for valid signature + present device + matching epoch', () => {
    devices.add('mobile-1', 'iPhone');
    const epoch = devices.incrementAuthEpoch('mobile-1');
    const token = generateToken(SECRET, 'mobile-1', epoch);
    const payload = validateAuthedToken(SECRET, token, devices);
    expect(payload).not.toBeNull();
    expect(payload!.deviceId).toBe('mobile-1');
    expect(payload!.epoch).toBe(epoch);
  });

  it('returns null for invalid signature', () => {
    devices.add('mobile-1', 'iPhone');
    devices.incrementAuthEpoch('mobile-1');
    const token = generateToken(SECRET, 'mobile-1', 1);
    expect(validateAuthedToken('wrong-secret', token, devices)).toBeNull();
  });

  it('returns null when device row is absent', () => {
    const token = generateToken(SECRET, 'mobile-1', 1);
    expect(validateAuthedToken(SECRET, token, devices)).toBeNull();
  });

  it('returns null for stale epoch', () => {
    devices.add('mobile-1', 'iPhone');
    const oldEpoch = devices.incrementAuthEpoch('mobile-1');
    devices.incrementAuthEpoch('mobile-1');
    const token = generateToken(SECRET, 'mobile-1', oldEpoch);
    expect(validateAuthedToken(SECRET, token, devices)).toBeNull();
  });

  it('returns null when payload has no epoch (pre-feature token)', () => {
    devices.add('mobile-1', 'iPhone');
    devices.incrementAuthEpoch('mobile-1');
    const token = generateToken(SECRET, 'mobile-1');
    expect(validateAuthedToken(SECRET, token, devices)).toBeNull();
  });
});
