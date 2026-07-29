import type {
  NotificationCategory,
  NotificationTarget,
} from "@/lib/notifications/contracts";

const localizedTitles: Record<NotificationCategory, { vi: string; en: string }> = {
  invoiceCreated: {
    vi: "Hóa đơn mới đã được tạo",
    en: "A new invoice was created",
  },
  purchaseReceived: {
    vi: "Đã ghi nhận phiếu nhập hàng",
    en: "A purchase receipt was recorded",
  },
  debtChanged: {
    vi: "Công nợ vừa được cập nhật",
    en: "A debt balance was updated",
  },
  qrPaymentConfirmed: {
    vi: "Đã xác nhận thanh toán QR",
    en: "QR payment confirmed",
  },
  qrPaymentException: {
    vi: "Cần kiểm tra giao dịch QR",
    en: "QR payment needs review",
  },
};

const qrCategories = new Set<NotificationCategory>([
  "qrPaymentConfirmed",
  "qrPaymentException",
]);

export type FcmMessageInput = {
  token: string;
  locale?: string | null;
  eventId: string;
  notificationKey: string;
  category: NotificationCategory;
  target: NotificationTarget;
  entityId: string;
  now?: Date;
};

export type FcmFailure =
  | { kind: "retry"; code: string; retryAfterMs?: number }
  | { kind: "disable-token"; code: string }
  | { kind: "permanent"; code: string };

type FcmErrorBody = {
  error?: {
    status?: unknown;
    details?: unknown;
  };
};

function safeStatus(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const status = (body as FcmErrorBody).error?.status;
  return typeof status === "string" && /^[A-Z_]{1,48}$/.test(status)
    ? status
    : undefined;
}

function tokenErrorDetail(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const details = (body as FcmErrorBody).error?.details;
  if (!Array.isArray(details)) return undefined;
  for (const detail of details) {
    if (!detail || typeof detail !== "object") continue;
    const value = detail as Record<string, unknown>;
    if (
      value["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError"
      && typeof value.errorCode === "string"
    ) {
      return value.errorCode;
    }
  }
  return undefined;
}

export function classifyFcmFailure(statusCode: number, body: unknown): FcmFailure {
  const status = safeStatus(body);
  const tokenError = tokenErrorDetail(body);

  if (
    status === "UNREGISTERED"
    || tokenError === "UNREGISTERED"
  ) {
    return { kind: "disable-token", code: "FCM_UNREGISTERED" };
  }
  if (status === "INVALID_ARGUMENT" && tokenError === "INVALID_ARGUMENT") {
    return { kind: "disable-token", code: "FCM_INVALID_TOKEN" };
  }
  if (tokenError === "SENDER_ID_MISMATCH") {
    return { kind: "disable-token", code: "FCM_SENDER_ID_MISMATCH" };
  }

  if (
    statusCode === 429
    || statusCode >= 500
    || status === "RESOURCE_EXHAUSTED"
    || status === "UNAVAILABLE"
    || status === "INTERNAL"
  ) {
    return {
      kind: "retry",
      code: `FCM_${status ?? (statusCode === 429 ? "RATE_LIMITED" : "UNAVAILABLE")}`,
    };
  }

  return {
    kind: "permanent",
    code: `FCM_${status ?? (statusCode >= 400 && statusCode < 600
      ? String(statusCode)
      : "INVALID_RESPONSE")}`,
  };
}

export function buildFcmMessage(input: FcmMessageInput) {
  const highPriority = qrCategories.has(input.category);
  const language = input.locale?.toLowerCase().startsWith("en") ? "en" : "vi";
  const ttlSeconds = highPriority ? 10 * 60 : 24 * 60 * 60;
  const now = input.now ?? new Date();

  return {
    message: {
      token: input.token,
      notification: {
        title: localizedTitles[input.category][language],
        body: language === "en"
          ? "Open LumaPOS to view details."
          : "Mở LumaPOS để xem chi tiết.",
      },
      data: {
        kind: "operational_alert",
        version: "1",
        category: input.category,
        target: input.target,
        eventId: input.eventId,
        entityId: input.entityId,
        notificationKey: input.notificationKey,
      },
      android: {
        priority: highPriority ? "high" : "normal",
        ttl: `${ttlSeconds}s`,
      },
      apns: {
        headers: {
          "apns-priority": highPriority ? "10" : "5",
          "apns-push-type": "alert",
          "apns-expiration": String(Math.floor(now.getTime() / 1000) + ttlSeconds),
        },
        payload: {
          aps: highPriority ? { sound: "default" } : {},
        },
      },
    },
  } as const;
}
