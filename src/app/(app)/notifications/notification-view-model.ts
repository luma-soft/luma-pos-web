export type NotificationTab = "action" | "all" | "activity";
export type NotificationTimePreset = "all" | "today" | "7d" | "30d" | "custom";
export type NotificationStatusFilter = "all" | "action" | "unread" | "processed";
export type NotificationLevelFilter = "all" | "high" | "warning" | "info";

export type NotificationAction = {
  type?: string;
  target?: string;
  id?: string;
  href?: string;
  label?: string;
  viLabel?: string;
  primary?: boolean;
};

export type NotificationRow = {
  id: string;
  category: string;
  title: string;
  body: string;
  unread: boolean;
  priority: string;
  createdAt: string;
  action?: NotificationAction;
};

export type NotificationFilters = {
  timePreset: NotificationTimePreset;
  from: string;
  to: string;
  status: NotificationStatusFilter;
  level: NotificationLevelFilter;
  category: string;
  source: string;
};

export const defaultNotificationFilters: NotificationFilters = {
  timePreset: "all",
  from: "",
  to: "",
  status: "all",
  level: "all",
  category: "all",
  source: "all",
};

const inventoryCategories = new Set(["lowStock", "purchaseReceived"]);
const salesCategories = new Set(["invoiceCreated", "qrPaymentConfirmed"]);
const warningPriorities = new Set(["medium"]);
const infoPriorities = new Set(["low", "normal"]);

export function notificationCategory(category: string) {
  if (inventoryCategories.has(category)) return "inventory";
  if (category === "einvoiceError") return "einvoice";
  if (category === "debtChanged") return "debt";
  if (salesCategories.has(category)) return "sales";
  return "system";
}

export function notificationSource(category: string) {
  if (category === "lowStock") return "ai";
  if (category === "qrPaymentConfirmed" || category === "qrPaymentException") return "pos";
  if (category === "serviceDue") return "mobile";
  return "system";
}

export function notificationLevel(priority: string): Exclude<NotificationLevelFilter, "all"> {
  if (priority === "high") return "high";
  if (warningPriorities.has(priority)) return "warning";
  return "info";
}

export function notificationCreatedAt(row: NotificationRow) {
  const date = new Date(row.createdAt);
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return null;
  return date;
}

export function isActionableNotification(row: NotificationRow) {
  return row.unread && !infoPriorities.has(row.priority);
}

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

export function resolvedNotificationRange(
  preset: NotificationTimePreset,
  now = new Date(),
) {
  if (preset === "all" || preset === "custom") return null;
  const to = endOfDay(now);
  const from = startOfDay(now);
  if (preset === "7d") from.setDate(from.getDate() - 6);
  if (preset === "30d") from.setDate(from.getDate() - 29);
  return { from, to };
}

function customRange(filters: NotificationFilters) {
  if (filters.timePreset !== "custom" || !filters.from || !filters.to) return null;
  const from = startOfDay(new Date(`${filters.from}T00:00:00`));
  const to = endOfDay(new Date(`${filters.to}T00:00:00`));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return { from, to };
}

export function applyNotificationFilters(
  rows: NotificationRow[],
  filters: NotificationFilters,
  _tab: NotificationTab,
  now = new Date(),
) {
  const range = customRange(filters) ?? resolvedNotificationRange(filters.timePreset, now);
  return rows.filter((row) => {
    if (filters.status === "action" && !isActionableNotification(row)) return false;
    if (filters.status === "unread" && !row.unread) return false;
    if (filters.status === "processed" && row.unread) return false;
    if (filters.level !== "all" && notificationLevel(row.priority) !== filters.level) return false;
    if (filters.category !== "all" && notificationCategory(row.category) !== filters.category) return false;
    if (filters.source !== "all" && notificationSource(row.category) !== filters.source) return false;
    if (range) {
      const createdAt = notificationCreatedAt(row);
      if (createdAt && (createdAt < range.from || createdAt > range.to)) return false;
    }
    return true;
  });
}

export function countActiveNotificationFilters(filters: NotificationFilters) {
  return [
    filters.timePreset !== "all",
    filters.status !== "all",
    filters.level !== "all",
    filters.category !== "all",
    filters.source !== "all",
  ].filter(Boolean).length;
}
