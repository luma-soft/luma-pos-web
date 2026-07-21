import { getProfileId } from "@/lib/actions/common";
import { db } from "@/db";
import { einvoices, mobileNotificationStates, orders } from "@/db/schema";
import { getRestockSuggestions } from "@/lib/data/ai-restock";
import { getCurrentShift } from "@/lib/data/shifts";
import { getStoreSettings } from "@/lib/data/settings";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileGate, mobileOk } from "@/lib/mobile/response";
import { mobileNotificationSettingsForRole } from "@/lib/settings/mobile-settings-access";
import { and, desc, eq, inArray } from "drizzle-orm";

export async function GET() {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate)!;

  const profileId = await getProfileId(gate.userId);
  const [store, restock, shift, failedEinvoices] = await Promise.all([
    getStoreSettings(),
    getRestockSuggestions(30),
    getCurrentShift(profileId ?? gate.userId),
    db.select({
      id: einvoices.id,
      orderCode: orders.code,
      attemptCount: einvoices.attemptCount,
    })
      .from(einvoices)
      .innerJoin(orders, eq(orders.id, einvoices.orderId))
      .where(eq(einvoices.status, "error"))
      .orderBy(desc(einvoices.createdAt))
      .limit(10),
  ]);
  const prefs = store.prefs.notifications;
  const routed = (category: keyof typeof prefs.roleRouting) =>
    prefs.roleRouting[category].includes(gate.role);
  const restockRows = prefs.lowStock && routed("lowStock")
    ? restock.filter((row) =>
        row.priority === "high"
        || (row.daysOfStock != null && row.daysOfStock <= prefs.thresholds.lowStockDays)
      ).slice(0, 10)
    : [];
  const routedEinvoices = failedEinvoices.filter(
    (row) => row.attemptCount >= prefs.thresholds.einvoiceFailureAttempts,
  );
  const stateUserId = profileId ?? gate.userId;
  const rows = [
    ...restockRows.map((row) => ({
      id: `restock-${row.id}`,
      category: "lowStock",
      title: row.name,
      body: `Tồn ${row.stock} ${row.baseUnit}, bán TB ${row.velocity.toFixed(1)}/ngày`,
      unread: true,
      priority: row.priority,
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
  const visibleRows = rows
    .filter((row) => stateById.get(row.id)?.dismissed !== true)
    .map((row) => ({
      ...row,
      unread: row.unread && stateById.get(row.id)?.read !== true,
    }));
  const visibleSettings = mobileNotificationSettingsForRole(prefs, gate.role);

  return mobileOk({
    rows: visibleRows,
    counts: {
      all: visibleRows.length,
      unread: visibleRows.filter((row) => row.unread).length,
      lowStock: restockRows.length,
      einvoiceError: routedEinvoices.length,
      shiftClose: prefs.shiftClose && routed("shiftClose") ? 1 : 0,
    },
    ...(visibleSettings ? { settings: visibleSettings } : {}),
  });
}
