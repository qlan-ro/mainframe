import type Database from 'better-sqlite3';
import type { Device } from '@qlan-ro/mainframe-types';

export interface DeviceRow extends Device {
  authEpoch: number;
}

export class DevicesRepository {
  constructor(private db: Database.Database) {}

  add(deviceId: string, deviceName: string): void {
    this.db
      .prepare(
        `INSERT INTO devices (device_id, device_name, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET device_name = excluded.device_name`,
      )
      .run(deviceId, deviceName, new Date().toISOString());
  }

  remove(deviceId: string): void {
    this.db.prepare('DELETE FROM devices WHERE device_id = ?').run(deviceId);
  }

  getAll(): Device[] {
    const rows = this.db
      .prepare('SELECT device_id, device_name, created_at, last_seen FROM devices ORDER BY created_at DESC')
      .all() as {
      device_id: string;
      device_name: string;
      created_at: string;
      last_seen: string | null;
    }[];
    return rows.map((r) => ({
      deviceId: r.device_id,
      deviceName: r.device_name,
      createdAt: r.created_at,
      lastSeen: r.last_seen,
    }));
  }

  updateLastSeen(deviceId: string): void {
    this.db.prepare('UPDATE devices SET last_seen = ? WHERE device_id = ?').run(new Date().toISOString(), deviceId);
  }

  findByDeviceId(deviceId: string): DeviceRow | null {
    const row = this.db
      .prepare('SELECT device_id, device_name, created_at, last_seen, auth_epoch FROM devices WHERE device_id = ?')
      .get(deviceId) as
      | { device_id: string; device_name: string; created_at: string; last_seen: string | null; auth_epoch: number }
      | undefined;
    if (!row) return null;
    return {
      deviceId: row.device_id,
      deviceName: row.device_name,
      createdAt: row.created_at,
      lastSeen: row.last_seen,
      authEpoch: row.auth_epoch,
    };
  }

  incrementAuthEpoch(deviceId: string): number {
    const row = this.db
      .prepare('UPDATE devices SET auth_epoch = auth_epoch + 1 WHERE device_id = ? RETURNING auth_epoch')
      .get(deviceId) as { auth_epoch: number } | undefined;
    return row?.auth_epoch ?? 0;
  }
}
