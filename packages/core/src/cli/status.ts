import { getConfig } from '../config.js';

export async function runStatus(): Promise<void> {
  const config = getConfig();
  const baseUrl = `http://127.0.0.1:${config.port}`;

  // Fetch health
  let health: { status: string; timestamp: string; tunnelUrl?: string | null };
  try {
    const res = await fetch(`${baseUrl}/health`);
    health = (await res.json()) as typeof health;
  } catch {
    console.error('Cannot reach daemon at %s. Is it running?', baseUrl);
    process.exit(1);
  }

  console.log('\n  Mainframe Daemon');
  console.log('  Status:     %s', health.status);
  console.log('  Port:       %d', config.port);
  console.log('  Tunnel:     %s', health.tunnelUrl ?? 'not active');
  console.log('  Data dir:   %s', config.dataDir);

  // Fetch devices
  try {
    const res = await fetch(`${baseUrl}/api/auth/devices`);
    const body = (await res.json()) as { data: { deviceId: string; deviceName: string; lastSeen: string | null }[] };
    const devices = body.data;

    if (devices.length === 0) {
      console.log('\n  Paired devices: none');
    } else {
      console.log('\n  Paired devices:');
      for (const d of devices) {
        const seen = d.lastSeen ? new Date(d.lastSeen).toLocaleString() : 'never';
        console.log('    - %s (%s) — last seen: %s', d.deviceName, d.deviceId, seen);
      }
    }
  } catch {
    console.log('\n  Could not fetch device list.');
  }

  console.log('');
  process.exit(0);
}
