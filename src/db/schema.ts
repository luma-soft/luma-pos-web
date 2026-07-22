import {
  pgTable, uuid, text, varchar, integer, decimal, timestamp, date,
  boolean, jsonb, primaryKey, index, uniqueIndex, pgEnum, check,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import type { StorePrefs } from "@/lib/schemas/settings";
import type { ServiceChecklistItem } from "@/lib/services/domain";

// ============= Enums =============

export const userRoleEnum = pgEnum("user_role", ["owner", "manager", "cashier", "warehouse"]);
export const orderStatusEnum = pgEnum("order_status", [
  "draft", "quote", "confirmed", "delivering", "completed", "cancelled", "returned", "merged",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "unpaid", "deposit", "partial", "paid", "refunded",
]);
export const paymentMethodEnum = pgEnum("payment_method", [
  "cash", "bank_transfer", "card", "vnpay", "momo", "zalopay", "credit", "exchange_credit",
]);
export const stockMovementTypeEnum = pgEnum("stock_movement_type", [
  "purchase", "sale", "return_in", "return_out", "transfer", "adjust", "init", "internal_use",
]);
export const customerTypeEnum = pgEnum("customer_type", [
  "retail", "wholesale", "contractor", "agent",
]);
export const customerConsentStatusEnum = pgEnum("customer_consent_status", [
  "pending", "granted", "withdrawn",
]);
export const serviceTypeEnum = pgEnum("service_type", [
  "camera", "electrical", "plumbing", "mixed",
]);
export const serviceProjectStageEnum = pgEnum("service_project_stage", [
  "planning", "quoted", "active", "paused", "completed", "warranty", "cancelled",
]);
export const serviceJobStatusEnum = pgEnum("service_job_status", [
  "new", "scheduled", "in_progress", "waiting_materials", "waiting_customer", "completed", "warranty", "cancelled",
]);
export const serviceJobPriorityEnum = pgEnum("service_job_priority", [
  "low", "normal", "high", "urgent",
]);
export const serviceAssetStatusEnum = pgEnum("service_asset_status", [
  "installed", "repair", "replaced", "removed",
]);
export const warrantyClaimStatusEnum = pgEnum("warranty_claim_status", [
  "new", "scheduled", "in_progress", "waiting_materials", "waiting_supplier", "resolved", "closed", "void",
]);

export const auditLogSourceEnum = pgEnum("audit_log_source", [
  "manual", "ai", "mobile", "pos", "system",
]);
export const auditLogStatusEnum = pgEnum("audit_log_status", [
  "previewed", "confirmed", "succeeded", "failed", "cancelled", "unauthorized",
]);

// ============= Users (linked to Supabase auth.users) =============

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  fullName: text("full_name").notNull(),
  phone: varchar("phone", { length: 20 }),
  role: userRoleEnum("role").notNull().default("cashier"),
  isActive: boolean("is_active").notNull().default(true),
  cashierPinHash: text("cashier_pin_hash"),
  cashierPinFailedAttempts: integer("cashier_pin_failed_attempts").notNull().default(0),
  cashierPinLockedUntil: timestamp("cashier_pin_locked_until", { withTimezone: true }),
  cashierPinUpdatedAt: timestamp("cashier_pin_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const mobileApprovals = pgTable("mobile_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  requesterId: uuid("requester_id").notNull().references(() => profiles.id),
  approverId: uuid("approver_id").notNull().references(() => profiles.id),
  permission: text("permission").notNull(),
  scope: text("scope"),
  mode: text("mode").notNull(),
  reason: text("reason"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("mobile_approvals_requester_idx").on(t.requesterId, t.createdAt),
  index("mobile_approvals_expiry_idx").on(t.expiresAt),
]);

// ============= General Audit Log =============

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").references(() => profiles.id),
  actorNameSnapshot: text("actor_name_snapshot"),
  source: auditLogSourceEnum("source").notNull().default("manual"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  status: auditLogStatusEnum("status").notNull().default("succeeded"),
  prompt: text("prompt"),
  parsedIntent: jsonb("parsed_intent").$type<Record<string, unknown> | unknown[] | null>(),
  before: jsonb("before").$type<Record<string, unknown> | unknown[] | null>(),
  after: jsonb("after").$type<Record<string, unknown> | unknown[] | null>(),
  affectedRecords: jsonb("affected_records").$type<Record<string, unknown>[] | null>(),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("audit_logs_actor_idx").on(t.actorId, t.createdAt),
  index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  index("audit_logs_created_idx").on(t.createdAt),
  index("audit_logs_source_status_idx").on(t.source, t.status),
]);

// ============= AI Chat Sessions =============

export const aiChatSessions = pgTable("ai_chat_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").references(() => profiles.id),
  surface: text("surface").notNull().default("web"),
  title: text("title").notNull().default("AI Assistant"),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("ai_chat_sessions_owner_idx").on(t.ownerId, t.updatedAt),
  index("ai_chat_sessions_surface_idx").on(t.surface, t.updatedAt),
]);

export const aiChatMessages = pgTable("ai_chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => aiChatSessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  state: text("state"),
  attachments: jsonb("attachments").$type<Record<string, unknown>[] | null>(),
  preview: jsonb("preview").$type<Record<string, unknown> | null>(),
  result: text("result"),
  record: jsonb("record").$type<Record<string, unknown> | null>(),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("ai_chat_messages_session_idx").on(t.sessionId, t.createdAt),
]);

// ============= Categories =============

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("categories_parent_idx").on(t.parentId)]);

// ============= Brands =============

export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  logoUrl: text("logo_url"),
});

// ============= Price books (bảng giá động) =============
// Bảng giá mặc định (isDefault) đọc products.retailPrice. Bảng khác lưu override
// trong product_prices; thiếu override thì fallback về retailPrice.

export const priceBooks = pgTable("price_books", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const productPrices = pgTable("product_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  priceBookId: uuid("price_book_id").notNull().references(() => priceBooks.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  price: decimal("price", { precision: 14, scale: 2 }).notNull(),
}, (t) => [
  uniqueIndex("product_prices_book_product_idx").on(t.priceBookId, t.productId),
  index("product_prices_product_idx").on(t.productId), // tra giá theo nhóm SP (trang Thiết lập giá)
]);

// ============= Warehouses =============

export const warehouses = pgTable("warehouses", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  address: text("address"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============= Products =============
// 1 product = 1 SKU. Variants are separate products linked by parent_id
// (gạch 60×60 đỏ matte vs 60×60 đỏ bóng = 2 products)

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  sku: varchar("sku", { length: 50 }).notNull().unique(),
  barcode: varchar("barcode", { length: 50 }),
  name: text("name").notNull(),
  fullName: text("full_name"), // "Gạch granite Viglacera 60x60 Đỏ Matte"
  parentProductId: uuid("parent_product_id").references((): AnyPgColumn => products.id, { onDelete: "set null" }),
  variantName: text("variant_name"),
  isVariantParent: boolean("is_variant_parent").notNull().default(false),
  description: text("description"),
  categoryId: uuid("category_id").references(() => categories.id),
  brandId: uuid("brand_id").references(() => brands.id),
  supplierId: uuid("supplier_id").references(() => suppliers.id), // NCC mặc định

  // Multi-unit: base unit is the smallest (viên, cái, m)
  baseUnit: varchar("base_unit", { length: 20 }).notNull().default("cái"), // viên, cái, m, kg

  // Pricing (giá vốn = giá nhập sau chiết khấu; giá nhập cuối = giá trên phiếu chưa chiết khấu)
  costPrice: decimal("cost_price", { precision: 14, scale: 2 }).notNull().default("0"),
  lastPurchasePrice: decimal("last_purchase_price", { precision: 14, scale: 2 }),
  retailPrice: decimal("retail_price", { precision: 14, scale: 2 }).notNull().default("0"),
  wholesalePrice: decimal("wholesale_price", { precision: 14, scale: 2 }),
  contractorPrice: decimal("contractor_price", { precision: 14, scale: 2 }),
  agentPrice: decimal("agent_price", { precision: 14, scale: 2 }),
  vatRate: decimal("vat_rate", { precision: 5, scale: 2 }),
  priceByWeight: boolean("price_by_weight").notNull().default(false),
  trackBatches: boolean("track_batches").notNull().default(false),
  shelfLifeDays: integer("shelf_life_days"),
  lifecycleStatus: varchar("lifecycle_status", { length: 20 }).notNull().default("active"),

  // Đặc thù VLXD
  // gạch: m² mỗi viên, viên mỗi hộp -> tự tính khi user nhập kích thước phòng
  m2PerUnit: decimal("m2_per_unit", { precision: 10, scale: 4 }), // 1 viên = 0.36 m²
  weight: decimal("weight", { precision: 10, scale: 3 }),
  dimensions: text("dimensions"), // "600×600×9mm"
  specs: jsonb("specs"), // { color, finish, series, ... } tùy biến

  // Tồn kho denormalize (trigger tự đồng bộ từ stock_levels) — để trang Tồn kho
  // đọc thẳng, bỏ GROUP BY/SUM nặng. Xem supabase/denormalize-stock.sql.
  totalStock: decimal("total_stock", { precision: 14, scale: 4 }).notNull().default("0"),
  minStock: decimal("min_stock", { precision: 14, scale: 4 }).notNull().default("0"),

  // Bảo hành
  warrantyMonths: integer("warranty_months").default(0),

  // Vị trí trên kệ (KiotViet: "Vị trí")
  location: text("location"),

  imageUrls: jsonb("image_urls").$type<string[]>().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("products_sku_idx").on(t.sku),
  index("products_barcode_idx").on(t.barcode),
  index("products_name_idx").on(t.name),
  index("products_category_idx").on(t.categoryId),
  index("products_parent_idx").on(t.parentProductId),
  index("products_variant_parent_idx").on(t.isVariantParent, t.parentProductId),
  index("products_lifecycle_status_idx").on(t.lifecycleStatus),
  // danh sách SP lọc đang bán + sắp theo ngày tạo (trang Sản phẩm/Thiết lập giá)
  index("products_active_created_idx").on(t.isActive, t.createdAt),
  index("products_total_stock_idx").on(t.totalStock), // lọc/sắp theo tồn (trang Tồn kho)
]);

// ============= Product Units (multi đơn vị tính) =============
// Ví dụ gạch: base unit = viên, 1 hộp = 11 viên, 1 m² = 2.78 viên
//   → 2 rows: { unit: "hộp", multiplier: 11 }, { unit: "m²", multiplier: 2.78 }

export const productUnits = pgTable("product_units", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  unitName: varchar("unit_name", { length: 30 }).notNull(), // hộp, m², thùng, pallet
  multiplier: decimal("multiplier", { precision: 14, scale: 4 }).notNull(), // 1 unitName = N base units
  barcode: varchar("barcode", { length: 50 }),
  priceOverride: decimal("price_override", { precision: 14, scale: 2 }),
  sortOrder: integer("sort_order").default(0),
}, (t) => [index("product_units_product_idx").on(t.productId)]);

// 1 sản phẩm mua được từ NHIỀU nhà cung cấp (products.supplierId = NCC chính)
export const productSuppliers = pgTable("product_suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  isPrimary: boolean("is_primary").notNull().default(false),
  supplierSku: varchar("supplier_sku", { length: 50 }), // mã hàng phía NCC
  costPrice: decimal("cost_price", { precision: 14, scale: 2 }), // giá nhập từ NCC này
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("product_suppliers_product_idx").on(t.productId),
  uniqueIndex("product_suppliers_uniq").on(t.productId, t.supplierId),
]);

// ============= Stock Levels =============

export const stockLevels = pgTable("stock_levels", {
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "cascade" }),
  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull().default("0"), // base unit
  reserved: decimal("reserved", { precision: 14, scale: 4 }).notNull().default("0"), // đã đặt cọc
  minLevel: decimal("min_level", { precision: 14, scale: 4 }).default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.productId, t.warehouseId] })]);

// ============= Stock Movements (audit) =============

export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id),
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id),
  type: stockMovementTypeEnum("type").notNull(),
  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull(), // signed: + nhập, - xuất
  unitCost: decimal("unit_cost", { precision: 14, scale: 2 }),
  refType: text("ref_type"), // 'order' | 'purchase' | 'transfer' | ...
  refId: uuid("ref_id"),
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("stock_movements_product_idx").on(t.productId),
  index("stock_movements_ref_idx").on(t.refType, t.refId),
]);

// ============= Customers =============

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).unique(), // KH001
  name: text("name").notNull(),
  phone: varchar("phone", { length: 20 }),
  zaloUserId: text("zalo_user_id"),
  email: text("email"),
  address: text("address"),
  type: customerTypeEnum("type").notNull().default("retail"),
  taxCode: varchar("tax_code", { length: 30 }), // MST cho công ty
  // Công nợ
  debtLimit: decimal("debt_limit", { precision: 14, scale: 2 }).default("0"),
  currentDebt: decimal("current_debt", { precision: 14, scale: 2 }).notNull().default("0"),
  totalSpent: decimal("total_spent", { precision: 14, scale: 2 }).notNull().default("0"),
  portalToken: varchar("portal_token", { length: 40 }).unique(), // link đặt hàng online
  note: text("note"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("customers_phone_idx").on(t.phone),
  index("customers_zalo_user_id_idx").on(t.zaloUserId),
  index("customers_name_idx").on(t.name),
]);

// ============= Customer PDPL Consent =============

export const customerConsents = pgTable("customer_consents", {
  customerId: uuid("customer_id").primaryKey().references(() => customers.id, { onDelete: "cascade" }),
  status: customerConsentStatusEnum("status").notNull().default("pending"),
  purposes: jsonb("purposes").$type<Record<string, boolean>>().notNull().default({}),
  source: text("source").notNull().default("mobile"),
  note: text("note"),
  updatedBy: uuid("updated_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const customerConsentEvents = pgTable("customer_consent_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  status: customerConsentStatusEnum("status").notNull(),
  purposes: jsonb("purposes").$type<Record<string, boolean>>().notNull().default({}),
  source: text("source").notNull().default("mobile"),
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("customer_consent_events_customer_idx").on(t.customerId, t.createdAt),
]);

export const mobileNotificationStates = pgTable("mobile_notification_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  notificationId: text("notification_id").notNull(),
  read: boolean("read").notNull().default(false),
  dismissed: boolean("dismissed").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("mobile_notification_states_user_notification_idx").on(t.userId, t.notificationId),
]);

export const mobilePushDevices = pgTable("mobile_push_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  effectiveUserId: uuid("effective_user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  deviceId: varchar("device_id", { length: 120 }).notNull(),
  platform: varchar("platform", { length: 20 }).notNull(),
  token: text("token").notNull().unique(),
  permission: varchar("permission", { length: 20 }).notNull().default("authorized"),
  enabled: boolean("enabled").notNull().default(true),
  locale: varchar("locale", { length: 20 }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("mobile_push_devices_user_device_idx").on(t.userId, t.deviceId),
  index("mobile_push_devices_user_enabled_idx").on(t.userId, t.enabled),
  index("mobile_push_devices_effective_user_enabled_idx").on(t.effectiveUserId, t.enabled),
]);

export const mobilePushDeliveries = pgTable("mobile_push_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: uuid("device_id").notNull().references(() => mobilePushDevices.id, { onDelete: "cascade" }),
  notificationKey: varchar("notification_key", { length: 180 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  attempts: integer("attempts").notNull().default(1),
  errorCode: varchar("error_code", { length: 80 }),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("mobile_push_deliveries_device_notification_idx")
    .on(t.deviceId, t.notificationKey),
  index("mobile_push_deliveries_status_idx").on(t.status, t.attemptedAt),
]);

export const mobileTelemetryEvents = pgTable("mobile_telemetry_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  eventType: varchar("event_type", { length: 32 }).notNull(),
  platform: varchar("platform", { length: 16 }).notNull(),
  appVersion: varchar("app_version", { length: 32 }).notNull(),
  metric: varchar("metric", { length: 32 }),
  screen: varchar("screen", { length: 32 }),
  durationMs: integer("duration_ms"),
  success: boolean("success"),
  errorType: varchar("error_type", { length: 80 }),
  fingerprint: varchar("fingerprint", { length: 16 }),
  attemptedCount: integer("attempted_count"),
  succeededCount: integer("succeeded_count"),
  failedCount: integer("failed_count"),
  conflictCount: integer("conflict_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("mobile_telemetry_events_type_created_idx").on(t.eventType, t.createdAt),
]);

// ============= Suppliers =============

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).unique(),
  name: text("name").notNull(),
  phone: varchar("phone", { length: 20 }),
  email: text("email"),
  address: text("address"),
  taxCode: varchar("tax_code", { length: 30 }),
  currentDebt: decimal("current_debt", { precision: 14, scale: 2 }).notNull().default("0"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============= Payment providers / bank accounts =============

export const paymentBankAccounts = pgTable("payment_bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("sepay"),
  bankCode: varchar("bank_code", { length: 40 }).notNull(),
  gateway: varchar("gateway", { length: 80 }),
  accountNumber: varchar("account_number", { length: 80 }).notNull(),
  subAccount: varchar("sub_account", { length: 80 }),
  accountName: text("account_name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  webhookEnabled: boolean("webhook_enabled").notNull().default(true),
  webhookSecret: text("webhook_secret"),
  apiKey: text("api_key"),
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("payment_bank_accounts_provider_idx").on(t.provider),
  index("payment_bank_accounts_enabled_idx").on(t.enabled),
  uniqueIndex("payment_bank_accounts_provider_account_idx").on(t.provider, t.accountNumber, t.subAccount),
]);

// ============= Orders (POS + Quotes + Construction) =============

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull().unique(), // HD20260506-001
  // Khử trùng đơn khi đồng bộ offline: mỗi đơn từ POS có 1 clientId; sync lại
  // không tạo đơn trùng (unique). Xem supabase/order-client-id.sql.
  clientId: varchar("client_id", { length: 40 }).unique(),
  status: orderStatusEnum("status").notNull().default("draft"),
  paymentStatus: paymentStatusEnum("payment_status").notNull().default("unpaid"),
  shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "set null" }),

  customerId: uuid("customer_id").references(() => customers.id),
  warehouseId: uuid("warehouse_id").references(() => warehouses.id),

  // Project / công trình
  projectName: text("project_name"),
  projectId: uuid("project_id"),
  deliveryAddress: text("delivery_address"),
  deliveryDate: timestamp("delivery_date", { withTimezone: true }),

  subtotal: decimal("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  discount: decimal("discount", { precision: 14, scale: 2 }).notNull().default("0"),
  tax: decimal("tax", { precision: 14, scale: 2 }).notNull().default("0"),
  shippingFee: decimal("shipping_fee", { precision: 14, scale: 2 }).notNull().default("0"),
  total: decimal("total", { precision: 14, scale: 2 }).notNull().default("0"),
  amountPaid: decimal("amount_paid", { precision: 14, scale: 2 }).notNull().default("0"),

  // Hóa đơn tạo từ thao tác sửa/sao chép hóa đơn gốc trên POS.
  sourceOrderId: uuid("source_order_id"),
  sourceMode: varchar("source_mode", { length: 20 }),
  sourceSaleTime: timestamp("source_sale_time", { withTimezone: true }),
  replacedByOrderId: uuid("replaced_by_order_id"),

  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("orders_status_idx").on(t.status),
  index("orders_customer_idx").on(t.customerId),
  index("orders_created_idx").on(t.createdAt),
  index("orders_shift_idx").on(t.shiftId),
  index("orders_source_idx").on(t.sourceOrderId),
  index("orders_replaced_by_idx").on(t.replacedByOrderId),
]);

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  productName: text("product_name").notNull(), // snapshot
  unitName: varchar("unit_name", { length: 30 }).notNull(), // unit dùng khi bán
  unitMultiplier: decimal("unit_multiplier", { precision: 14, scale: 4 }).notNull(), // snapshot

  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 14, scale: 2 }).notNull(),
  discount: decimal("discount", { precision: 14, scale: 2 }).notNull().default("0"),
  total: decimal("total", { precision: 14, scale: 2 }).notNull(),
  note: text("note"),
}, (t) => [index("order_items_order_idx").on(t.orderId)]);

// ============= Payments (đặt cọc, thanh toán nhiều đợt) =============

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "set null" }),
  status: text("status").notNull().default("manual_confirmed"),
  provider: text("provider"),
  bankAccountId: uuid("bank_account_id").references(() => paymentBankAccounts.id, { onDelete: "set null" }),
  providerTransactionId: text("provider_transaction_id"),
  clientRequestId: varchar("client_request_id", { length: 80 }),
  gateway: text("gateway"),
  accountNumber: text("account_number"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  rawMatchedEventId: uuid("raw_matched_event_id"),
  checkoutUrl: text("checkout_url"),
  deepLink: text("deep_link"),
  qrPayload: text("qr_payload"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastProviderStatus: text("last_provider_status"),
  lastProviderError: text("last_provider_error"),
  lastProviderCheckedAt: timestamp("last_provider_checked_at", { withTimezone: true }),
  providerQueryAttempts: integer("provider_query_attempts").notNull().default(0),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  method: paymentMethodEnum("method").notNull(),
  reference: text("reference"), // mã GD ngân hàng
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("payments_order_idx").on(t.orderId),
  index("payments_shift_idx").on(t.shiftId),
  index("payments_status_idx").on(t.status),
  index("payments_provider_reference_idx").on(t.provider, t.reference),
  index("payments_bank_account_idx").on(t.bankAccountId),
  uniqueIndex("payments_provider_transaction_idx").on(t.provider, t.providerTransactionId),
  uniqueIndex("payments_provider_client_request_idx").on(t.provider, t.clientRequestId),
  uniqueIndex("payments_manual_client_request_idx")
    .on(t.clientRequestId)
    .where(sql`${t.provider} is null and ${t.clientRequestId} is not null`),
  index("payments_provider_expiry_idx").on(t.provider, t.status, t.expiresAt),
  index("payments_provider_query_idx").on(t.provider, t.status, t.lastProviderCheckedAt),
]);

export const paymentWebhookEvents = pgTable("payment_webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("sepay"),
  providerEventId: text("provider_event_id").notNull(),
  bankAccountId: uuid("bank_account_id").references(() => paymentBankAccounts.id, { onDelete: "set null" }),
  matchedPaymentId: uuid("matched_payment_id").references(() => payments.id, { onDelete: "set null" }),
  referenceCode: text("reference_code"),
  accountNumber: text("account_number"),
  subAccount: text("sub_account"),
  gateway: text("gateway"),
  transferType: text("transfer_type"),
  transferAmount: decimal("transfer_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  transactionDate: timestamp("transaction_date", { withTimezone: true }),
  content: text("content"),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("received"),
  matchStatus: text("match_status").notNull().default("unmatched"),
  matchReason: text("match_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("payment_webhook_events_provider_event_idx").on(t.provider, t.providerEventId),
  index("payment_webhook_events_match_idx").on(t.matchStatus),
  index("payment_webhook_events_payment_idx").on(t.matchedPaymentId),
  index("payment_webhook_events_account_idx").on(t.accountNumber, t.subAccount),
]);

// ============= Purchase Orders (nhập hàng) =============

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id),
  status: text("status").notNull().default("draft"), // draft, received, cancelled
  subtotal: decimal("subtotal", { precision: 14, scale: 2 }).notNull().default("0"), // tổng tiền hàng (sau giảm giá dòng)
  discount: decimal("discount", { precision: 14, scale: 2 }).notNull().default("0"), // giảm giá cả phiếu
  vatRate: decimal("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),    // % VAT
  tax: decimal("tax", { precision: 14, scale: 2 }).notNull().default("0"),            // tiền VAT
  total: decimal("total", { precision: 14, scale: 2 }).notNull().default("0"),
  amountPaid: decimal("amount_paid", { precision: 14, scale: 2 }).notNull().default("0"),
  invoiceNumber: varchar("invoice_number", { length: 50 }), // số hóa đơn đầu vào
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull(),
  unitCost: decimal("unit_cost", { precision: 14, scale: 2 }).notNull(),
  discount: decimal("discount", { precision: 14, scale: 2 }).notNull().default("0"), // giảm giá dòng
  total: decimal("total", { precision: 14, scale: 2 }).notNull(),
  batchNumber: varchar("batch_number", { length: 80 }),
  expiryDate: date("expiry_date"),
});

// ============= Stock lots (batch / expiry ledger) =============

export const stockLots = pgTable("stock_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),
  purchaseOrderItemId: uuid("purchase_order_item_id").references(() => purchaseOrderItems.id, { onDelete: "set null" }),
  batchNumber: varchar("batch_number", { length: 80 }).notNull(),
  expiryDate: date("expiry_date"),
  receivedQuantity: decimal("received_quantity", { precision: 14, scale: 4 }).notNull(),
  availableQuantity: decimal("available_quantity", { precision: 14, scale: 4 }).notNull(),
  unitCost: decimal("unit_cost", { precision: 14, scale: 2 }),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid("created_by").references(() => profiles.id),
}, (t) => [
  index("stock_lots_product_warehouse_idx").on(t.productId, t.warehouseId),
  index("stock_lots_expiry_idx").on(t.expiryDate),
  index("stock_lots_purchase_item_idx").on(t.purchaseOrderItemId),
]);

export const stockLotMovements = pgTable("stock_lot_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  stockLotId: uuid("stock_lot_id").notNull().references(() => stockLots.id, { onDelete: "cascade" }),
  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull(),
  refType: text("ref_type").notNull(),
  refId: uuid("ref_id").notNull(),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("stock_lot_movements_lot_idx").on(t.stockLotId, t.createdAt),
  index("stock_lot_movements_ref_idx").on(t.refType, t.refId),
]);

// ============= Purchase Returns (trả hàng nhập/NCC) =============

export const purchaseReturns = pgTable("purchase_returns", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id),
  status: text("status").notNull().default("completed"), // completed, draft (reserved for future)
  settlementStatus: text("settlement_status").notNull().default("unsettled"), // unsettled, partial, settled
  subtotal: decimal("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  discount: decimal("discount", { precision: 14, scale: 2 }).notNull().default("0"),
  vatRate: decimal("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  tax: decimal("tax", { precision: 14, scale: 2 }).notNull().default("0"),
  totalRefund: decimal("total_refund", { precision: 14, scale: 2 }).notNull().default("0"),
  refundAmount: decimal("refund_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  refundMethod: text("refund_method"),
  debtAmount: decimal("debt_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("purchase_returns_purchase_idx").on(t.purchaseOrderId),
  index("purchase_returns_supplier_idx").on(t.supplierId, t.createdAt),
  index("purchase_returns_created_idx").on(t.createdAt),
]);

export const purchaseReturnItems = pgTable("purchase_return_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseReturnId: uuid("purchase_return_id").notNull().references(() => purchaseReturns.id, { onDelete: "cascade" }),
  purchaseOrderItemId: uuid("purchase_order_item_id").references(() => purchaseOrderItems.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  productName: text("product_name").notNull(),
  sku: varchar("sku", { length: 50 }).notNull(),
  unitName: varchar("unit_name", { length: 30 }).notNull(),
  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull(),
  unitCost: decimal("unit_cost", { precision: 14, scale: 2 }).notNull(),
  returnUnitCost: decimal("return_unit_cost", { precision: 14, scale: 2 }).notNull(),
  total: decimal("total", { precision: 14, scale: 2 }).notNull(),
}, (t) => [
  index("purchase_return_items_return_idx").on(t.purchaseReturnId),
  index("purchase_return_items_product_idx").on(t.productId),
]);

// ============= Returns (trả hàng theo hóa đơn) =============

export const refundMethodEnum = pgEnum("refund_method", [
  "cash", "bank_transfer", "debt_deduct", "momo", "zalopay", "vnpay",
]);

export const returns = pgTable("returns", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull().unique(), // TH-...
  clientId: varchar("client_id", { length: 80 }),
  // nullable: trả hàng nhanh không gắn hóa đơn (vd lịch sử KiotViet)
  orderId: uuid("order_id").references(() => orders.id),
  customerId: uuid("customer_id").references(() => customers.id),
  warehouseId: uuid("warehouse_id").references(() => warehouses.id),
  reason: text("reason"),
  refundMethod: refundMethodEnum("refund_method").notNull().default("cash"),
  totalRefund: decimal("total_refund", { precision: 14, scale: 2 }).notNull().default("0"),
  exchangeOrderId: uuid("exchange_order_id").references(() => orders.id),
  exchangeDifference: decimal("exchange_difference", { precision: 14, scale: 2 }),
  exchangeSettlementMethod: text("exchange_settlement_method"),
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("returns_order_idx").on(t.orderId),
  index("returns_exchange_order_idx").on(t.exchangeOrderId),
  uniqueIndex("returns_client_id_idx").on(t.clientId),
]);

export const returnItems = pgTable("return_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  returnId: uuid("return_id").notNull().references(() => returns.id, { onDelete: "cascade" }),
  orderItemId: uuid("order_item_id").references(() => orderItems.id), // null = trả nhanh
  productId: uuid("product_id").notNull().references(() => products.id),
  productName: text("product_name").notNull(),
  unitName: varchar("unit_name", { length: 30 }).notNull(),
  unitMultiplier: decimal("unit_multiplier", { precision: 14, scale: 4 }).notNull(),
  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 14, scale: 2 }).notNull(),
  total: decimal("total", { precision: 14, scale: 2 }).notNull(),
  restock: boolean("restock").notNull().default(true), // false = hàng hỏng, không nhập lại kho bán
}, (t) => [index("return_items_return_idx").on(t.returnId)]);

export const paymentRefunds = pgTable("payment_refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  returnId: uuid("return_id").notNull().references(() => returns.id, { onDelete: "restrict" }),
  paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("pending"),
  provider: text("provider").notNull(),
  reference: varchar("reference", { length: 100 }).notNull(),
  clientRequestId: varchar("client_request_id", { length: 80 }).notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  providerRefundTransactionId: text("provider_refund_transaction_id"),
  providerStatus: text("provider_status"),
  providerError: text("provider_error"),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull().default({}),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  lastProviderCheckedAt: timestamp("last_provider_checked_at", { withTimezone: true }),
  providerQueryAttempts: integer("provider_query_attempts").notNull().default(0),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("payment_refunds_return_idx").on(t.returnId),
  uniqueIndex("payment_refunds_client_request_idx").on(t.clientRequestId),
  uniqueIndex("payment_refunds_provider_reference_idx").on(t.provider, t.reference),
  uniqueIndex("payment_refunds_provider_transaction_idx").on(t.provider, t.providerRefundTransactionId),
  index("payment_refunds_payment_idx").on(t.paymentId),
  index("payment_refunds_status_query_idx").on(t.status, t.lastProviderCheckedAt),
]);

// ============= Sổ quỹ thu chi =============

export const cashTxTypeEnum = pgEnum("cash_tx_type", ["in", "out"]);
export const cashFundEnum = pgEnum("cash_fund", ["cash", "bank"]);

export const cashTransactions = pgTable("cash_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull().unique(), // PT-/PC-
  shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "set null" }),
  type: cashTxTypeEnum("type").notNull(),
  fund: cashFundEnum("fund").notNull().default("cash"),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  // sale | debt_collect | supplier_payment | refund | expense | other
  category: text("category").notNull(),
  refType: text("ref_type"),
  refId: uuid("ref_id"),
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("cash_tx_created_idx").on(t.createdAt),
  index("cash_tx_shift_idx").on(t.shiftId),
]);

// ============= Công trình / dự án =============

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  customerId: uuid("customer_id").references(() => customers.id),
  address: text("address"),
  status: text("status").notNull().default("active"), // active | done
  serviceType: serviceTypeEnum("service_type"),
  serviceStage: serviceProjectStageEnum("service_stage"),
  progressPercent: integer("progress_percent").notNull().default(0),
  startsOn: date("starts_on"),
  targetEndsOn: date("target_ends_on"),
  siteContactName: text("site_contact_name"),
  siteContactPhone: varchar("site_contact_phone", { length: 20 }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("projects_customer_idx").on(t.customerId)]);

// ============= Thi công & dịch vụ =============

export const serviceJobs = pgTable("service_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 30 }).notNull().unique(),
  serviceType: serviceTypeEnum("service_type").notNull(),
  title: text("title").notNull(),
  status: serviceJobStatusEnum("status").notNull().default("new"),
  priority: serviceJobPriorityEnum("priority").notNull().default("normal"),
  assignedTo: uuid("assigned_to").references(() => profiles.id, { onDelete: "set null" }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  description: text("description"),
  checklist: jsonb("checklist").$type<ServiceChecklistItem[]>().notNull().default([]),
  quoteOrderId: uuid("quote_order_id").references(() => orders.id, { onDelete: "set null" }),
  materialOrderId: uuid("material_order_id").references(() => orders.id, { onDelete: "set null" }),
  completionNote: text("completion_note"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("service_jobs_project_idx").on(t.projectId, t.createdAt),
  index("service_jobs_status_schedule_idx").on(t.status, t.scheduledAt),
  index("service_jobs_assignee_idx").on(t.assignedTo, t.status),
]);

export const serviceJobMaterials = pgTable("service_job_materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => serviceJobs.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  unitName: varchar("unit_name", { length: 30 }).notNull(),
  plannedQuantity: decimal("planned_quantity", { precision: 14, scale: 4 }).notNull().default("0"),
  usedQuantity: decimal("used_quantity", { precision: 14, scale: 4 }).notNull().default("0"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("service_job_materials_job_product_unit_idx").on(t.jobId, t.productId, t.unitName),
  index("service_job_materials_product_idx").on(t.productId),
]);

export const serviceCostEntries = pgTable("service_cost_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => serviceJobs.id, { onDelete: "set null" }),
  type: text("type").notNull(), // labor | subcontractor | transport | other
  description: text("description").notNull(),
  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull().default("1"),
  unitCost: decimal("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  staffId: uuid("staff_id").references(() => profiles.id, { onDelete: "set null" }),
  incurredOn: date("incurred_on").notNull().defaultNow(),
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("service_cost_entries_type_check", sql`${t.type} in ('labor', 'subcontractor', 'transport', 'other')`),
  check("service_cost_entries_amount_check", sql`${t.quantity} >= 0 and ${t.unitCost} >= 0 and ${t.amount} >= 0`),
  index("service_cost_entries_project_idx").on(t.projectId, t.incurredOn),
  index("service_cost_entries_job_idx").on(t.jobId),
]);

export const serviceMaterialAllocations = pgTable("service_material_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  materialId: uuid("material_id").notNull().references(() => serviceJobMaterials.id, { onDelete: "cascade" }),
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),
  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull(),
  remainingQuantity: decimal("remaining_quantity", { precision: 14, scale: 4 }).notNull(),
  status: text("status").notNull().default("reserved"), // reserved | consumed | released
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("service_material_allocations_status_check", sql`${t.status} in ('reserved', 'consumed', 'released')`),
  check("service_material_allocations_quantity_check", sql`${t.quantity} > 0 and ${t.remainingQuantity} >= 0 and ${t.remainingQuantity} <= ${t.quantity}`),
  index("service_material_allocations_material_idx").on(t.materialId, t.status),
  index("service_material_allocations_warehouse_idx").on(t.warehouseId, t.status),
]);

export const serviceHandoverDocuments = pgTable("service_handover_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => serviceJobs.id, { onDelete: "set null" }),
  type: text("type").notNull(), // survey | acceptance | handover
  title: text("title").notNull(),
  content: text("content"),
  photoUrls: jsonb("photo_urls").$type<string[]>().notNull().default([]),
  signedBy: text("signed_by"),
  signedAt: date("signed_at"),
  status: text("status").notNull().default("draft"), // draft | signed
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("service_handover_documents_type_check", sql`${t.type} in ('survey', 'acceptance', 'handover')`),
  check("service_handover_documents_status_check", sql`${t.status} in ('draft', 'signed')`),
  index("service_handover_documents_project_idx").on(t.projectId, t.createdAt),
]);

export const serviceMaintenancePlans = pgTable("service_maintenance_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").references(() => installedAssets.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  intervalDays: integer("interval_days").notNull(),
  nextDueOn: date("next_due_on").notNull(),
  lastCompletedOn: date("last_completed_on"),
  assignedTo: uuid("assigned_to").references(() => profiles.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("service_maintenance_plans_interval_check", sql`${t.intervalDays} > 0`),
  index("service_maintenance_plans_due_idx").on(t.isActive, t.nextDueOn),
  index("service_maintenance_plans_project_idx").on(t.projectId, t.isActive),
]);

export const installedAssets = pgTable("installed_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => serviceJobs.id, { onDelete: "set null" }),
  productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
  assetKind: text("asset_kind").notNull(),
  name: text("name").notNull(),
  brand: text("brand"),
  model: text("model"),
  serialNumber: text("serial_number"),
  macAddress: text("mac_address"),
  ipAddress: text("ip_address"),
  locationLabel: text("location_label"),
  installedAt: timestamp("installed_at", { withTimezone: true }),
  customerWarrantyEndsOn: date("customer_warranty_ends_on"),
  supplierWarrantyEndsOn: date("supplier_warranty_ends_on"),
  status: serviceAssetStatusEnum("status").notNull().default("installed"),
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("installed_assets_project_idx").on(t.projectId, t.status),
  index("installed_assets_job_idx").on(t.jobId),
  uniqueIndex("installed_assets_serial_idx").on(t.serialNumber),
]);

export const warrantyClaims = pgTable("warranty_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => serviceJobs.id, { onDelete: "set null" }),
  assetId: uuid("asset_id").references(() => installedAssets.id, { onDelete: "set null" }),
  code: varchar("code", { length: 30 }).notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  status: warrantyClaimStatusEnum("status").notNull().default("new"),
  priority: serviceJobPriorityEnum("priority").notNull().default("normal"),
  reportedAt: timestamp("reported_at", { withTimezone: true }).defaultNow().notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  diagnosis: text("diagnosis"),
  resolution: text("resolution"),
  laborCharge: decimal("labor_charge", { precision: 14, scale: 2 }).notNull().default("0"),
  materialCharge: decimal("material_charge", { precision: 14, scale: 2 }).notNull().default("0"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("warranty_claims_project_idx").on(t.projectId, t.status),
  index("warranty_claims_asset_idx").on(t.assetId),
  index("warranty_claims_schedule_idx").on(t.status, t.scheduledAt),
]);

export const serviceStatusLogs = pgTable("service_status_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => serviceJobs.id, { onDelete: "cascade" }),
  fromStatus: serviceJobStatusEnum("from_status"),
  toStatus: serviceJobStatusEnum("to_status").notNull(),
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("service_status_logs_job_idx").on(t.jobId, t.createdAt)]);

// ============= Khuyến mãi (bậc thang theo SL) =============

export const promotions = pgTable("promotions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  // [{ minQty: 50, discountPct: 3 }] — minQty theo đơn vị gốc
  tiers: jsonb("tiers").$type<{ minQty: number; discountPct: number }[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("promotions_product_idx").on(t.productId)]);

// ============= Điều xe / giao hàng =============

export const tripStatusEnum = pgEnum("trip_status", ["planned", "ongoing", "done"]);

export const trips = pgTable("trips", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull().unique(), // CX-
  vehicle: text("vehicle"),
  driver: text("driver"),
  status: tripStatusEnum("status").notNull().default("planned"),
  departAt: timestamp("depart_at", { withTimezone: true }),
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tripStops = pgTable("trip_stops", {
  id: uuid("id").primaryKey().defaultRandom(),
  tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  sortOrder: integer("sort_order").default(0),
  status: text("status").notNull().default("pending"), // pending | delivered
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  note: text("note"),
}, (t) => [index("trip_stops_trip_idx").on(t.tripId)]);

// ============= Hóa đơn điện tử =============

export const einvoiceStatusEnum = pgEnum("einvoice_status", [
  "draft",
  "queued",
  "processing",
  "issued",
  "error",
]);

export const einvoices = pgTable("einvoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id).unique(),
  status: einvoiceStatusEnum("status").notNull().default("draft"),
  serial: varchar("serial", { length: 20 }),
  number: varchar("number", { length: 20 }),
  buyerName: text("buyer_name").notNull(),
  buyerTaxCode: varchar("buyer_tax_code", { length: 30 }),
  buyerAddress: text("buyer_address"),
  buyerEmail: text("buyer_email"),
  provider: varchar("provider", { length: 40 }),
  requestId: varchar("request_id", { length: 80 }).unique(),
  providerReference: text("provider_reference"),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  queuedAt: timestamp("queued_at", { withTimezone: true }),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockToken: varchar("lock_token", { length: 80 }),
  lastError: text("last_error"),
  vatRate: decimal("vat_rate", { precision: 5, scale: 2 }).notNull().default("10"),
  totalBeforeVat: decimal("total_before_vat", { precision: 14, scale: 2 }).notNull().default("0"),
  vatAmount: decimal("vat_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("einvoices_retry_idx").on(t.status, t.nextAttemptAt),
  index("einvoices_lock_idx").on(t.lockedAt),
]);

// ============= Kiểm kho (stocktake) =============

export const stocktakeStatusEnum = pgEnum("stocktake_status", ["draft", "balanced", "cancelled"]);

export const stocktakes = pgTable("stocktakes", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull().unique(), // KK-
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id),
  status: stocktakeStatusEnum("status").notNull().default("draft"),
  note: text("note"),
  balancedAt: timestamp("balanced_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const stocktakeItems = pgTable("stocktake_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  stocktakeId: uuid("stocktake_id").notNull().references(() => stocktakes.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  systemQty: decimal("system_qty", { precision: 14, scale: 4 }).notNull(), // tồn hệ thống lúc kiểm
  actualQty: decimal("actual_qty", { precision: 14, scale: 4 }).notNull(), // đếm thực tế
}, (t) => [index("stocktake_items_st_idx").on(t.stocktakeId)]);

// ============= Print templates (mẫu in theo loại chứng từ) =============

export const printDocTypeEnum = pgEnum("print_doc_type", [
  "order", "quote", "booking", "purchase", "return", "receipt",
]);
export const paperSizeEnum = pgEnum("paper_size", ["a4", "a5", "k80"]);

export const printTemplates = pgTable("print_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  docType: printDocTypeEnum("doc_type").notNull(),
  paperDefault: paperSizeEnum("paper_default").notNull().default("a5"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  storeName: text("store_name").notNull().default(""),
  storeAddress: text("store_address").notNull().default(""),
  storePhone: text("store_phone").notNull().default(""),
  storeTaxCode: text("store_tax_code").notNull().default(""),
  footerNote: text("footer_note").notNull().default(""),
  // toggles: showSeller, showProject, showDebt, showInWords, showSignatures, fontSize...
  options: jsonb("options").$type<Record<string, boolean | string | number>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("print_templates_doc_type_idx").on(t.docType),
  index("print_templates_active_idx").on(t.isActive),
  uniqueIndex("print_templates_default_doc_type_idx").on(t.docType).where(sql`${t.isDefault} = true and ${t.isActive} = true`),
]);

// ============= Barcode label templates (mẫu in tem mã sản phẩm) =============

export const labelTemplates = pgTable("label_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  widthMm: decimal("width_mm", { precision: 8, scale: 2 }).notNull().default("40"),
  heightMm: decimal("height_mm", { precision: 8, scale: 2 }).notNull().default("30"),
  columns: integer("columns").notNull().default(3),
  gapMm: decimal("gap_mm", { precision: 8, scale: 2 }).notNull().default("2"),
  barcodeType: text("barcode_type").notNull().default("code128"),
  showName: boolean("show_name").notNull().default(true),
  showSku: boolean("show_sku").notNull().default(true),
  showPrice: boolean("show_price").notNull().default(true),
  showUnit: boolean("show_unit").notNull().default(false),
  showBarcodeText: boolean("show_barcode_text").notNull().default(true),
  showStoreName: boolean("show_store_name").notNull().default(false),
  barcodeHeightMm: decimal("barcode_height_mm", { precision: 8, scale: 2 }).notNull().default("10"),
  barcodeQuietMm: decimal("barcode_quiet_mm", { precision: 8, scale: 2 }).notNull().default("2"),
  fontScale: decimal("font_scale", { precision: 4, scale: 2 }).notNull().default("1"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("label_templates_active_idx").on(t.isActive),
  uniqueIndex("label_templates_default_idx").on(t.isDefault).where(sql`${t.isDefault} = true and ${t.isActive} = true`),
]);

// ============= Shifts (Quản lý ca — Part 17) =============

export const shifts = pgTable("shifts", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  userId: uuid("user_id").references(() => profiles.id),
  openingFloat: decimal("opening_float", { precision: 14, scale: 2 }).notNull().default("0"),
  openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  expectedCash: decimal("expected_cash", { precision: 14, scale: 2 }),
  countedCash: decimal("counted_cash", { precision: 14, scale: 2 }),
  variance: decimal("variance", { precision: 14, scale: 2 }),
  status: text("status").notNull().default("open"),
  note: text("note"),
  handoverToUserId: uuid("handover_to_user_id").references(() => profiles.id),
  handoverFromShiftId: uuid("handover_from_shift_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("shifts_status_idx").on(t.status),
  index("shifts_user_idx").on(t.userId),
  index("shifts_handover_to_user_idx").on(t.handoverToUserId),
  index("shifts_handover_from_shift_idx").on(t.handoverFromShiftId),
  uniqueIndex("shifts_open_user_unique_idx").on(t.userId).where(sql`${t.status} = 'open'`),
]);

// ============= F&B dining tables (Part 18) =============

export const diningTables = pgTable("dining_tables", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  zone: text("zone").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("free"),
  currentCart: jsonb("current_cart").$type<Array<{ lineId: string; productId: string; productName: string; unitName: string; unitMultiplier: number; quantity: number; basePrice: number; unitPrice: number; modifiers: { label: string; priceDelta: number }[]; note?: string; sent: boolean }>>().notNull().default([]),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("dining_tables_zone_idx").on(t.zone, t.sortOrder)]);

// ============= F&B deep: modifiers + kitchen tickets (Part 18.2) =============

export const modifierGroups = pgTable("modifier_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  multi: boolean("multi").notNull().default(false),
  required: boolean("required").notNull().default(false),
  options: jsonb("options").$type<{ id: string; label: string; priceDelta: number }[]>().notNull().default([]),
  categoryIds: jsonb("category_ids").$type<string[]>().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const kitchenTickets = pgTable("kitchen_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tableId: uuid("table_id").references(() => diningTables.id, { onDelete: "set null" }),
  tableName: text("table_name").notNull().default(""),
  round: integer("round").notNull().default(1),
  status: text("status").notNull().default("active"), // active | done
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("kitchen_tickets_status_idx").on(t.status, t.createdAt)]);

export const kitchenTicketItems = pgTable("kitchen_ticket_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull().references(() => kitchenTickets.id, { onDelete: "cascade" }),
  productId: uuid("product_id"),
  productName: text("product_name").notNull(),
  quantity: decimal("quantity", { precision: 14, scale: 3 }).notNull().default("1"),
  modifiers: jsonb("modifiers").$type<{ label: string; priceDelta: number }[]>().notNull().default([]),
  note: text("note"),
  course: text("course").notNull().default("asap"),
  fireAt: timestamp("fire_at", { withTimezone: true }),
  status: text("status").notNull().default("pending"), // pending | preparing | ready | served
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("kitchen_ticket_items_ticket_idx").on(t.ticketId),
  index("kitchen_ticket_items_fire_at_idx").on(t.fireAt, t.status),
]);

// ============= Store settings (singleton) =============

export const storeSettings = pgTable("store_settings", {
  id: text("id").primaryKey().default("default"),
  name: text("name").notNull().default(""),
  address: text("address").notNull().default(""),
  phone: text("phone").notNull().default(""),
  taxCode: text("tax_code").notNull().default(""),
  industry: text("industry").notNull().default("grocery"),
  currency: text("currency").notNull().default("VND"),
  locale: text("locale").notNull().default("vi-VN"),
  onboarded: boolean("onboarded").notNull().default(false),
  prefs: jsonb("prefs").$type<StorePrefs>().notNull().default({} as StorePrefs),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============= AI Usage (monthly quota) =============

export const aiUsageCounters = pgTable("ai_usage_counters", {
  period: varchar("period", { length: 7 }).primaryKey(), // YYYY-MM
  usedUnits: integer("used_units").notNull().default(0),
  limitUnits: integer("limit_units").notNull().default(1000),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedCostMicrousd: integer("estimated_cost_microusd").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const aiUsageEvents = pgTable("ai_usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  period: varchar("period", { length: 7 }).notNull(),
  provider: text("provider"),
  model: text("model"),
  actionType: text("action_type").notNull().default("assistant_request"),
  eventType: text("event_type").notNull().default("unit_charge"),
  surface: text("surface").notNull().default("web"),
  units: integer("units").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedCostMicrousd: integer("estimated_cost_microusd").notNull().default(0),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("ai_usage_events_period_idx").on(t.period, t.createdAt),
  index("ai_usage_events_action_idx").on(t.actionType, t.createdAt),
  index("ai_usage_events_provider_idx").on(t.provider, t.model),
]);

// ============= Zalo OA / ZNS message log =============

export const zaloMessageEvents = pgTable("zalo_message_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("pending"),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
  invoiceId: uuid("invoice_id").references(() => einvoices.id, { onDelete: "set null" }),
  phone: varchar("phone", { length: 30 }),
  templateId: varchar("template_id", { length: 80 }),
  zaloMessageId: text("zalo_message_id"),
  payloadSummary: jsonb("payload_summary").$type<Record<string, unknown> | null>(),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("zalo_message_events_kind_status_idx").on(t.kind, t.status, t.createdAt),
  index("zalo_message_events_customer_idx").on(t.customerId, t.createdAt),
  index("zalo_message_events_order_idx").on(t.orderId, t.createdAt),
]);

// ============= Marketplace integrations (Shopee first) =============

export const marketplaceShops = pgTable("marketplace_shops", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("shopee"),
  shopId: text("shop_id").notNull(),
  shopName: text("shop_name").notNull().default(""),
  region: varchar("region", { length: 10 }).notNull().default("VN"),
  status: text("status").notNull().default("disconnected"),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("marketplace_shops_provider_shop_idx").on(t.provider, t.shopId),
  index("marketplace_shops_provider_status_idx").on(t.provider, t.status),
]);

export const marketplaceTokens = pgTable("marketplace_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => marketplaceShops.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("marketplace_tokens_shop_idx").on(t.shopId),
]);

export const marketplaceProductMappings = pgTable("marketplace_product_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("shopee"),
  shopId: uuid("shop_id").references(() => marketplaceShops.id, { onDelete: "set null" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  externalItemId: text("external_item_id"),
  externalModelId: text("external_model_id"),
  externalSku: text("external_sku"),
  status: text("status").notNull().default("draft"),
  title: text("title").notNull().default(""),
  categoryId: text("category_id"),
  categoryPath: text("category_path"),
  price: decimal("price", { precision: 14, scale: 2 }),
  stock: decimal("stock", { precision: 14, scale: 4 }),
  syncMode: text("sync_mode").notNull().default("luma_to_shopee"),
  minStockThreshold: decimal("min_stock_threshold", { precision: 14, scale: 4 }).notNull().default("0"),
  outOfStockBehavior: text("out_of_stock_behavior").notNull().default("keep_visible"),
  draftPayload: jsonb("draft_payload").$type<Record<string, unknown>>().notNull().default({}),
  lastPayload: jsonb("last_payload").$type<Record<string, unknown> | null>(),
  lastResponse: jsonb("last_response").$type<Record<string, unknown> | null>(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("marketplace_product_mappings_provider_product_idx").on(t.provider, t.productId),
  uniqueIndex("marketplace_product_mappings_external_idx").on(t.provider, t.externalItemId),
  index("marketplace_product_mappings_status_idx").on(t.provider, t.status),
]);

export const marketplaceOrderMappings = pgTable("marketplace_order_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("shopee"),
  shopId: uuid("shop_id").references(() => marketplaceShops.id, { onDelete: "set null" }),
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
  externalOrderSn: text("external_order_sn").notNull(),
  externalStatus: text("external_status").notNull().default(""),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull().default({}),
  importedAt: timestamp("imported_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("marketplace_order_mappings_provider_order_idx").on(t.provider, t.externalOrderSn),
  index("marketplace_order_mappings_luma_order_idx").on(t.orderId),
]);

export const marketplaceMessageThreads = pgTable("marketplace_message_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("shopee"),
  shopId: uuid("shop_id").references(() => marketplaceShops.id, { onDelete: "set null" }),
  externalThreadId: text("external_thread_id").notNull(),
  externalBuyerId: text("external_buyer_id"),
  buyerName: text("buyer_name").notNull().default(""),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
  status: text("status").notNull().default("open"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("marketplace_message_threads_provider_thread_idx").on(t.provider, t.externalThreadId),
  index("marketplace_message_threads_last_idx").on(t.provider, t.lastMessageAt),
]);

export const marketplaceMessages = pgTable("marketplace_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => marketplaceMessageThreads.id, { onDelete: "cascade" }),
  externalMessageId: text("external_message_id"),
  direction: text("direction").notNull(),
  body: text("body").notNull().default(""),
  attachments: jsonb("attachments").$type<Record<string, unknown>[]>().notNull().default([]),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown> | null>(),
  sentBy: uuid("sent_by").references(() => profiles.id, { onDelete: "set null" }),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("marketplace_messages_external_idx").on(t.threadId, t.externalMessageId),
  index("marketplace_messages_thread_idx").on(t.threadId, t.sentAt),
]);

export const marketplaceSyncJobs = pgTable("marketplace_sync_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("shopee"),
  shopId: uuid("shop_id").references(() => marketplaceShops.id, { onDelete: "set null" }),
  jobType: text("job_type").notNull(),
  status: text("status").notNull().default("pending"),
  idempotencyKey: text("idempotency_key").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).defaultNow().notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  lastResponse: jsonb("last_response").$type<Record<string, unknown> | null>(),
  lastError: text("last_error"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("marketplace_sync_jobs_idempotency_idx").on(t.provider, t.idempotencyKey),
  index("marketplace_sync_jobs_status_idx").on(t.provider, t.status, t.nextRunAt),
]);

export const aiListingSuggestions = pgTable("ai_listing_suggestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("shopee"),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  mappingId: uuid("mapping_id").references(() => marketplaceProductMappings.id, { onDelete: "set null" }),
  model: text("model").notNull().default(""),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull().default({}),
  suggestion: jsonb("suggestion").$type<Record<string, unknown>>().notNull().default({}),
  editedFields: jsonb("edited_fields").$type<string[]>().notNull().default([]),
  revertedReason: text("reverted_reason"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("ai_listing_suggestions_product_idx").on(t.productId, t.createdAt),
]);

// ============= Internal-Use Issue (Xuất dùng nội bộ — Part 8.1) =============
// Phiếu xuất hàng dùng nội bộ (không bán): trừ kho theo giá vốn → COGS, không doanh thu.

export const internalUseIssues = pgTable("internal_use_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull().unique(), // XNB-...
  warehouseId: uuid("warehouse_id").references(() => warehouses.id),
  department: text("department"),       // bộ phận nhận
  reason: text("reason"),               // lý do (reason code, text)
  status: text("status").notNull().default("approved"), // 'pending' | 'approved'
  totalCost: decimal("total_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id),
  approvedBy: uuid("approved_by").references(() => profiles.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const internalUseItems = pgTable("internal_use_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  issueId: uuid("issue_id").notNull().references(() => internalUseIssues.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  productName: text("product_name").notNull(),
  unitName: varchar("unit_name", { length: 30 }).notNull(),
  unitMultiplier: decimal("unit_multiplier", { precision: 14, scale: 4 }).notNull(),
  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull(),
  unitCost: decimal("unit_cost", { precision: 14, scale: 2 }).notNull(),
  total: decimal("total", { precision: 14, scale: 2 }).notNull(),
}, (t) => [index("internal_use_items_issue_idx").on(t.issueId)]);

// ============= Relations =============

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  units: many(productUnits),
  stockLevels: many(stockLevels),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  warehouse: one(warehouses, { fields: [orders.warehouseId], references: [warehouses.id] }),
  items: many(orderItems),
  payments: many(payments),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));

export const stockLevelsRelations = relations(stockLevels, ({ one }) => ({
  product: one(products, { fields: [stockLevels.productId], references: [products.id] }),
  warehouse: one(warehouses, { fields: [stockLevels.warehouseId], references: [warehouses.id] }),
}));
