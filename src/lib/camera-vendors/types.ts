export type CameraDeviceSummary = {
  externalDeviceId: string;
  model: string | null;
  serialNumber: string | null;
  name: string | null;
};

export type CameraDeviceHealth = {
  online: boolean | null;
  status: "healthy" | "warning" | "offline" | "unknown";
  lastSeenAt: string | null;
  firmwareVersion: string | null;
  storageStatus: string | null;
};

export type CameraDeviceAlert = {
  externalAlertId: string;
  alertType: string;
  severity: "info" | "warning" | "critical";
  message: string | null;
  occurredAt: string;
  resolvedAt: string | null;
};

export interface CameraVendorAdapter {
  readonly vendor: string;
  getDeviceSummary(externalDeviceId: string): Promise<CameraDeviceSummary>;
  getDeviceHealth(externalDeviceId: string): Promise<CameraDeviceHealth>;
  listDeviceAlerts(externalDeviceId: string): Promise<CameraDeviceAlert[]>;
  buildVendorAppLink(externalDeviceId: string): string | null;
}
