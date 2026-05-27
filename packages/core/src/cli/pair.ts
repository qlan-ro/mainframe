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

  console.log('  Waiting for device to pair...');

  const pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`${baseUrl}/api/auth/pair-status?code=${encodeURIComponent(pairingCode)}`);
      const body = (await res.json()) as {
        data?: { paired: boolean; deviceId?: string; deviceName?: string };
      };
      if (body.data?.paired) {
        clearInterval(pollInterval);
        console.log('\n  Device paired: %s (%s)\n', body.data.deviceName ?? 'device', body.data.deviceId ?? '?');
        process.exit(0);
      }
    } catch {
      // transient network error — keep polling /* expected */
    }
  }, 2000);

  setTimeout(
    () => {
      clearInterval(pollInterval);
      console.log('\n  Pairing code expired. Run `mainframe-daemon pair` to try again.\n');
      process.exit(1);
    },
    5 * 60 * 1000,
  );
}
