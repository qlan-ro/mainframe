import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DevicesRepository } from '../devices.js';

describe('DevicesRepository', () => {
  let db: Database.Database;
  let devices: DevicesRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id   TEXT PRIMARY KEY,
        device_name TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        last_seen   TEXT,
        auth_epoch  INTEGER NOT NULL DEFAULT 0
      )
    `);
    devices = new DevicesRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('adds and retrieves a device', () => {
    devices.add('mobile-1', 'My iPhone');
    const all = devices.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.deviceId).toBe('mobile-1');
    expect(all[0]!.deviceName).toBe('My iPhone');
    expect(all[0]!.createdAt).toBeTruthy();
  });

  it('removes a device', () => {
    devices.add('mobile-1', 'My iPhone');
    devices.remove('mobile-1');
    expect(devices.getAll()).toHaveLength(0);
  });

  it('updates last_seen', () => {
    devices.add('mobile-1', 'My iPhone');
    devices.updateLastSeen('mobile-1');
    const all = devices.getAll();
    expect(all[0]!.lastSeen).toBeTruthy();
  });

  it('returns empty array when no devices', () => {
    expect(devices.getAll()).toEqual([]);
  });

  it('preserves created_at on re-add', () => {
    devices.add('mobile-1', 'My iPhone');
    const first = devices.getAll()[0]!.createdAt;
    devices.add('mobile-1', 'Renamed iPhone');
    const second = devices.getAll()[0]!;
    expect(second.createdAt).toBe(first);
    expect(second.deviceName).toBe('Renamed iPhone');
  });

  it('findByDeviceId returns null for unknown device', () => {
    expect(devices.findByDeviceId('nope')).toBeNull();
  });

  it('findByDeviceId returns device with authEpoch', () => {
    devices.add('mobile-1', 'My iPhone');
    const row = devices.findByDeviceId('mobile-1');
    expect(row).not.toBeNull();
    expect(row!.deviceId).toBe('mobile-1');
    expect(row!.authEpoch).toBe(0);
  });

  it('incrementAuthEpoch atomically bumps and returns the new value', () => {
    devices.add('mobile-1', 'My iPhone');
    expect(devices.incrementAuthEpoch('mobile-1')).toBe(1);
    expect(devices.incrementAuthEpoch('mobile-1')).toBe(2);
    expect(devices.findByDeviceId('mobile-1')!.authEpoch).toBe(2);
  });

  it('incrementAuthEpoch returns 0 for unknown device (no row updated)', () => {
    expect(devices.incrementAuthEpoch('ghost')).toBe(0);
  });
});
