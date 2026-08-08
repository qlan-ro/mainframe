import { useState, useEffect, useCallback } from 'react';
import { RotateCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { Label } from '@/components/ui/label';
import { getDevices, removeDevice } from '../../../../lib/api/remote-access';
import type { Device } from '@qlan-ro/mainframe-types';

interface DevicesSectionProps {
  port: number;
}

export function DevicesSection({ port }: DevicesSectionProps): React.ReactElement {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await getDevices(port);
      setDevices(data);
    } catch (err) {
      console.warn('[settings/DevicesSection] failed to load devices', err);
    } finally {
      setLoading(false);
    }
  }, [port]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRemove = useCallback(
    async (deviceId: string) => {
      // Optimistic filter: remove immediately from local state.
      setDevices((prev) => prev.filter((d) => d.deviceId !== deviceId));
      try {
        await removeDevice(port, deviceId);
      } catch (err) {
        console.warn('[settings/DevicesSection] failed to remove device', err);
        // Re-fetch to restore state if the delete failed.
        void refresh();
      }
    },
    [port, refresh],
  );

  return (
    <div data-testid="settings-remote-access-devices-section" className="flex flex-col gap-3">
      <div>
        <Label className="text-xs font-medium text-muted-foreground">Paired Devices</Label>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RotateCw size={14} className="animate-spin" />
          Loading...
        </div>
      ) : devices.length === 0 ? (
        <p className="text-xs text-muted-foreground">No paired devices.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {devices.map((device) => (
            <DeviceRow key={device.deviceId} device={device} onRemove={handleRemove} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceRow({ device, onRemove }: { device: Device; onRemove: (id: string) => void }): React.ReactElement {
  return (
    <div className="flex items-center justify-between p-2.5 bg-card border border-border rounded-md">
      <div>
        <span className="text-xs text-foreground">{device.deviceName}</span>
        <span className="text-xs text-muted-foreground ml-2">{new Date(device.createdAt).toLocaleDateString()}</span>
      </div>
      <Hint label="Remove device">
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid={`remote-access-device-remove-${device.deviceId}`}
          onClick={() => onRemove(device.deviceId)}
          aria-label="Remove device"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </Hint>
    </div>
  );
}
