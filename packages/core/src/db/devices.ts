import type Database from 'better-sqlite3';
import type { Device } from '@qlan-ro/mainframe-types';

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
}
