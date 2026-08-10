import { getProfileId } from "@/lib/actions/common";
import { db } from "@/db";
import { einvoices, mobileNotificationStates, orders } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import { getRestockSuggestions } from "@/lib/data/ai-restock";
import { getCurrentShift } from "@/lib/data/shifts";
import { getStoreSettings } from "@/lib/data/settings";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileGate, mobileOk } from "@/lib/mobile/response";
import {
  countPersistedMobileEvents,
  listPersistedMobileEvents,
} from "@/lib/notifications/mobile-events";
import { mobileNotificationSettingsForRole } from "@/lib/settings/mobile-settings-access";
import { listWarrantyNotificationsForRecipientCore } from "@/lib/services/technician-warranty";
import { and, desc, eq, inArray } from "drizzle-orm";

const LEGACY_FALLBACK_CREATED_AT = new Date(0).toISOString();

function requestedLocale(request: Request) {
  const queryLocale = new URL(request.url).searchParams.get("locale");
  if (queryLocale?.toLowerCase().startsWith("en")) return "en";
  if (queryLocale?.toLowerCase().startsWith("vi")) return "vi";
  return request.headers.get("accept-language")?.toLowerCase().startsWith("en")
    ? "en"
    : "vi";
}

export async function GET(request: Request) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate)!;

  const profileId = await getProfileId(gate.userId);
  const stateUserId = profileId ?? gate.userId;
  const [store, restock, shift, failedEinvoices, warrantyNotifications] = await Promise.all([
    getStoreSettings(gate.storeId),
    getRestockSuggestions(30),
    getCurrentShift(gate.storeId, profileId ?? gate.userId),
    db.select({
      id: einvoices.id,
      orderCode: orders.code,
      attemptCount: einvoices.attemptCount,
      createdAt: einvoices.createdAt,
    })
      .from(einvoices)
      .innerJoin(orders, eq(orders.id, einvoices.orderId))
      .where(eq(einvoices.status, "error"))
      .orderBy(desc(einvoices.createdAt))
      .limit(10),
    listWarrantyNotificationsForRecipientCore(db, stateUserId),
  ]);
  const effectiveProfileId = profileId ?? gate.userId;
  const [persistedRows, persistedCounts] = await Promise.all([
    listPersistedMobileEvents(effectiveProfileId, requestedLocale(request)),
    countPersistedMobileEvents(effectiveProfileId),
  ]);
  const prefs = store.prefs.notifications;
  const routed = (category: keyof typeof prefs.roleRouting) =>
    (prefs.roleRouting[category] as readonly Role[]).includes(gate.role);
  const restockRows = prefs.lowStock && routed("lowStock")
    ? restock.filter((row) =>
        row.priority === "high"
        || (row.daysOfStock != null && row.daysOfStock <= prefs.thresholds.lowStockDays)
      ).slice(0, 10)
    : [];
  const routedEinvoices = failedEinvoices.filter(
    (row) => row.attemptCount >= prefs.thresholds.einvoiceFailureAttempts,
  );
  const rows = [
    ...warrantyNotifications.map((row) => ({
      id: row.notificationId,
      category: "serviceDue",
      title: `${row.code}: ${row.title}`,
      body: `${row.projectName}${row.assetName ? ` · ${row.assetName}` : ""}`,
      unread: true,
      priority: row.priority,
      createdAt: row.createdAt.toISOString(),
      action: {
        type: "open",
        target: "services",
        id: row.jobId ?? row.claimId,
      },
    })),
    ...restockRows.map((row) => ({
      id: `restock-${row.id}`,
      category: "lowStock",
      title: row.name,
      body: `Tồn ${row.stock} ${row.baseUnit}, bán TB ${row.velocity.toFixed(1)}/ngày`,
      unread: true,
      priority: row.priority,
      createdAt: LEGACY_FALLBACK_CREATED_AT,
      action: { type: "open", target: "aiRestocking", id: row.id },
    })),
    ...(prefs.einvoiceError && routed("einvoiceError")
      ? routedEinvoices.map((row) => ({
          id: `einvoice-error-${row.id}`,
          category: "einvoiceError",
          title: `Hóa đơn điện tử ${row.orderCode} phát hành lỗi`,
          body: "Mở hóa đơn để kiểm tra trạng thái và thử lại.",
          unread: true,
          priority: "high" as const,
          createdAt: row.createdAt.toISOString(),
          action: { type: "open", target: "invoices", id: row.id },
        }))
      : []),
    ...(prefs.shiftClose && routed("shiftClose") ? [{
      id: shift ? `shift-${shift.id}` : "shift-open",
      category: "shiftClose",
      title: shift ? "Ca đang mở" : "Chưa mở ca",
      body: shift
        ? `Ca ${shift.code} mở từ ${shift.openedAt.toISOString()}`
        : "Mở ca trước khi bán hàng để chốt quỹ chính xác.",
      unread: !shift,
      priority: shift ? "low" : "medium",
      createdAt: shift?.openedAt.toISOString() ?? LEGACY_FALLBACK_CREATED_AT,
      action: { type: "open", target: "shift" },
    }] : []),
  ];
  const ids = rows.map((row) => row.id);
  const states = ids.length
    ? await db
        .select({
          notificationId: mobileNotificationStates.notificationId,
          read: mobileNotificationStates.read,
          dismissed: mobileNotificationStates.dismissed,
        })
        .from(mobileNotificationStates)
        .where(
          and(
            eq(mobileNotificationStates.userId, stateUserId),
            inArray(mobileNotificationStates.notificationId, ids)
          )
        )
    : [];
  const stateById = new Map(states.map((state) => [state.notificationId, state]));
  const visibleLegacyRows = rows
    .filter((row) => stateById.get(row.id)?.dismissed !== true)
    .map((row) => ({
      ...row,
      unread: row.unread && stateById.get(row.id)?.read !== true,
    }));
  const visibleRows = [...persistedRows, ...visibleLegacyRows].sort(
    (left, right) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt)
      || left.id.localeCompare(right.id),
  );
  const visibleSettings = mobileNotificationSettingsForRole(prefs, gate.role);
  const countLegacyCategory = (category: string) =>
    visibleLegacyRows.filter((row) => row.category === category).length;

  return mobileOk({
    rows: visibleRows,
    counts: {
      all: persistedCounts.all + visibleLegacyRows.length,
      unread: persistedCounts.unread
        + visibleLegacyRows.filter((row) => row.unread).length,
      lowStock: countLegacyCategory("lowStock"),
      einvoiceError: countLegacyCategory("einvoiceError"),
      shiftClose: countLegacyCategory("shiftClose"),
      warranty: countLegacyCategory("serviceDue"),
      invoiceCreated: persistedCounts.invoiceCreated
        + countLegacyCategory("invoiceCreated"),
      purchaseReceived: persistedCounts.purchaseReceived
        + countLegacyCategory("purchaseReceived"),
      debtChanged: persistedCounts.debtChanged
        + countLegacyCategory("debtChanged"),
      qrPaymentConfirmed: persistedCounts.qrPaymentConfirmed
        + countLegacyCategory("qrPaymentConfirmed"),
      qrPaymentException: persistedCounts.qrPaymentException
        + countLegacyCategory("qrPaymentException"),
    },
    ...(visibleSettings ? { settings: visibleSettings } : {}),
  });
}
