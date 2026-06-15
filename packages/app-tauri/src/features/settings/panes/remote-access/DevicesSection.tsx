import { useState, useEffect, useCallback } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
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
    <div className="space-y-3">
      <div>
        <label className="text-mf-small text-mf-text-secondary">Paired Devices</label>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-mf-small text-mf-text-secondary">
          <Loader2 size={14} className="animate-spin" />
          Loading...
        </div>
      ) : devices.length === 0 ? (
        <p className="text-mf-status text-mf-text-tertiary">No paired devices.</p>
      ) : (
        <div className="space-y-1.5">
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
    <div className="flex items-center justify-between p-2.5 bg-mf-input-bg border border-mf-divider rounded-mf-input">
      <div>
        <span className="text-mf-small text-mf-text-primary">{device.deviceName}</span>
        <span className="text-mf-status text-mf-text-tertiary ml-2">
          {new Date(device.createdAt).toLocaleDateString()}
        </span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            data-testid={`remote-access-device-remove-${device.deviceId}`}
            onClick={() => onRemove(device.deviceId)}
            className="p-1 text-mf-text-tertiary hover:text-red-400 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Remove device</TooltipContent>
      </Tooltip>
    </div>
  );
}
