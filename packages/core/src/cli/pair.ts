import { getConfig } from '../config.js';
import qrcode from 'qrcode-terminal';

export async function runPair(): Promise<void> {
  const config = getConfig();
  const baseUrl = `http://127.0.0.1:${config.port}`;

  // Check daemon is running
  let healthData: { tunnelUrl?: string | null };
  try {
    const res = await fetch(`${baseUrl}/health`);
    healthData = (await res.json()) as { tunnelUrl?: string | null };
  } catch {
    console.error('Cannot reach daemon at %s. Is it running?', baseUrl);
    process.exit(1);
  }

  // Request pairing code
  const pairRes = await fetch(`${baseUrl}/api/auth/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceName: 'CLI pairing' }),
  });

  if (!pairRes.ok) {
    const body = (await pairRes.json()) as { error?: string };
    console.error('Pairing failed: %s', body.error ?? pairRes.statusText);
    process.exit(1);
  }

  const { pairingCode } = ((await pairRes.json()) as { data: { pairingCode: string } }).data;
  const tunnelUrl = healthData.tunnelUrl ?? null;

  console.log('\n  Pairing code: %s', pairingCode);
  console.log('  Expires in 5 minutes\n');

  if (tunnelUrl) {
    const qrPayload = JSON.stringify({ url: tunnelUrl, code: pairingCode });
    console.log('  Enter this code in the Mainframe mobile app, or scan the QR code:\n');
    qrcode.generate(qrPayload, { small: true });
    console.log('\n  Tunnel URL: %s', tunnelUrl);
  } else {
    console.log('  Enter this code in the Mainframe mobile app.');
    console.log('  No tunnel active — start daemon with TUNNEL=true for remote pairing.\n');
  }

  // Poll for device confirmation
  console.log('  Waiting for device to pair...');
  const startDevices = await fetchDevices(baseUrl);
  const startIds = new Set(startDevices.map((d) => d.deviceId));

  const pollInterval = setInterval(async () => {
    const devices = await fetchDevices(baseUrl);
    const newDevice = devices.find((d) => !startIds.has(d.deviceId));
    if (newDevice) {
      clearInterval(pollInterval);
      console.log('\n  Device paired: %s (%s)\n', newDevice.deviceName, newDevice.deviceId);
      process.exit(0);
    }
  }, 2000);

  // Timeout after 5 minutes (matches pairing code expiry)
  setTimeout(
    () => {
      clearInterval(pollInterval);
      console.log('\n  Pairing code expired. Run `mainframe-daemon pair` to try again.\n');
      process.exit(1);
    },
    5 * 60 * 1000,
  );
}

async function fetchDevices(baseUrl: string): Promise<{ deviceId: string; deviceName: string }[]> {
  try {
    const res = await fetch(`${baseUrl}/api/auth/devices`);
    const body = (await res.json()) as { data: { deviceId: string; deviceName: string }[] };
    return body.data;
  } catch {
    return [];
  }
}
