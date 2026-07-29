import type {
  CameraDeviceAlert,
  CameraDeviceHealth,
  CameraDeviceSummary,
  CameraVendorAdapter,
} from "@/lib/camera-vendors/types";

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type EzvizAdapterOptions = {
  accessToken?: string;
  summaryUrlTemplate?: string;
  healthUrlTemplate?: string;
  alertsUrlTemplate?: string;
  appUrlTemplate?: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function templateUrl(template: string | undefined, externalDeviceId: string) {
  if (!template || !template.includes("{deviceId}")) {
    throw new Error("CAMERA_VENDOR_NOT_CONFIGURED");
  }
  return template.replaceAll("{deviceId}", encodeURIComponent(externalDeviceId));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export class DisabledCameraVendorAdapter implements CameraVendorAdapter {
  readonly vendor = "disabled";
  async getDeviceSummary(): Promise<CameraDeviceSummary> {
    throw new Error("CAMERA_VENDOR_DISABLED");
  }
  async getDeviceHealth(): Promise<CameraDeviceHealth> {
    throw new Error("CAMERA_VENDOR_DISABLED");
  }
  async listDeviceAlerts(): Promise<CameraDeviceAlert[]> {
    throw new Error("CAMERA_VENDOR_DISABLED");
  }
  buildVendorAppLink() {
    return null;
  }
}

export class EzvizReadOnlyAdapter implements CameraVendorAdapter {
  readonly vendor = "ezviz";
  constructor(private readonly options: EzvizAdapterOptions) {}

  private async request(template: string | undefined, externalDeviceId: string) {
    if (!this.options.accessToken) throw new Error("CAMERA_VENDOR_NOT_CONFIGURED");
    const response = await (this.options.fetcher ?? fetch)(
      templateUrl(template, externalDeviceId),
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${this.options.accessToken}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 8_000),
        cache: "no-store",
      },
    );
    if (response.status === 429) throw new Error("CAMERA_VENDOR_RATE_LIMITED");
    if (!response.ok) throw new Error(`CAMERA_VENDOR_HTTP_${response.status}`);
    return await response.json() as unknown;
  }

  async getDeviceSummary(externalDeviceId: string): Promise<CameraDeviceSummary> {
    const payload = record(await this.request(
      this.options.summaryUrlTemplate,
      externalDeviceId,
    ));
    return {
      externalDeviceId,
      model: text(payload.model),
      serialNumber: text(payload.serialNumber ?? payload.serial),
      name: text(payload.name ?? payload.deviceName),
    };
  }

  async getDeviceHealth(externalDeviceId: string): Promise<CameraDeviceHealth> {
    const payload = record(await this.request(
      this.options.healthUrlTemplate,
      externalDeviceId,
    ));
    const online = typeof payload.online === "boolean" ? payload.online : null;
    const rawStatus = text(payload.status);
    const status = rawStatus === "healthy"
      || rawStatus === "warning"
      || rawStatus === "offline"
      ? rawStatus
      : online === false ? "offline" : "unknown";
    return {
      online,
      status,
      lastSeenAt: text(payload.lastSeenAt),
      firmwareVersion: text(payload.firmwareVersion),
      storageStatus: text(payload.storageStatus),
    };
  }

  async listDeviceAlerts(externalDeviceId: string): Promise<CameraDeviceAlert[]> {
    const payload = await this.request(this.options.alertsUrlTemplate, externalDeviceId);
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(record(payload).alerts) ? record(payload).alerts as unknown[] : [];
    return rows.map(record).flatMap((item) => {
      const externalAlertId = text(item.externalAlertId ?? item.id);
      const alertType = text(item.alertType ?? item.type);
      const occurredAt = text(item.occurredAt);
      if (!externalAlertId || !alertType || !occurredAt) return [];
      const rawSeverity = text(item.severity);
      const severity = rawSeverity === "info" || rawSeverity === "critical"
        ? rawSeverity
        : "warning";
      return [{
        externalAlertId,
        alertType,
        severity,
        message: text(item.message),
        occurredAt,
        resolvedAt: text(item.resolvedAt),
      }];
    });
  }

  buildVendorAppLink(externalDeviceId: string) {
    if (!this.options.appUrlTemplate?.includes("{deviceId}")) return null;
    return this.options.appUrlTemplate.replaceAll(
      "{deviceId}",
      encodeURIComponent(externalDeviceId),
    );
  }
}

export function createCameraVendorAdapter(options: {
  enabled: boolean;
  vendor?: string;
} & EzvizAdapterOptions): CameraVendorAdapter {
  if (!options.enabled) return new DisabledCameraVendorAdapter();
  if (options.vendor === "ezviz") return new EzvizReadOnlyAdapter(options);
  return new DisabledCameraVendorAdapter();
}

export function cameraVendorAdapterFromEnv(): CameraVendorAdapter {
  return createCameraVendorAdapter({
    enabled: process.env.CAMERA_VENDOR_SYNC_ENABLED === "true",
    vendor: process.env.CAMERA_VENDOR,
    accessToken: process.env.EZVIZ_ACCESS_TOKEN,
    summaryUrlTemplate: process.env.EZVIZ_DEVICE_SUMMARY_URL_TEMPLATE,
    healthUrlTemplate: process.env.EZVIZ_DEVICE_HEALTH_URL_TEMPLATE,
    alertsUrlTemplate: process.env.EZVIZ_DEVICE_ALERTS_URL_TEMPLATE,
    appUrlTemplate: process.env.EZVIZ_APP_URL_TEMPLATE,
  });
}
