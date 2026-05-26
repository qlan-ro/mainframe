export interface Device {
  deviceId: string;
  deviceName: string;
  createdAt: string;
  lastSeen: string | null;
}

export interface DeviceRow extends Device {
  authEpoch: number;
}
