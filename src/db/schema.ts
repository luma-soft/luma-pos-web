import {
  pgTable, uuid, text, varchar, integer, decimal, timestamp,
  boolean, jsonb, primaryKey, index, uniqueIndex, pgEnum,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type { StorePrefs } from "@/lib/schemas/settings";

// ============= Enums =============

export const userRoleEnum = pgEnum("user_role", ["owner", "manager", "cashier", "warehouse"]);
export const orderStatusEnum = pgEnum("order_status", [
  "draft", "quote", "confirmed", "delivering", "completed", "cancelled", "returned", "merged",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "unpaid", "deposit", "partial", "paid", "refunded",
]);
export const paymentMethodEnum = pgEnum("payment_method", [
  "cash", "bank_transfer", "card", "vnpay", "momo", "credit",
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

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
  gateway: text("gateway"),
  accountNumber: text("account_number"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  rawMatchedEventId: uuid("raw_matched_event_id"),
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
});

// ============= Returns (trả hàng theo hóa đơn) =============

export const refundMethodEnum = pgEnum("refund_method", ["cash", "bank_transfer", "debt_deduct"]);

export const returns = pgTable("returns", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull().unique(), // TH-...
  // nullable: trả hàng nhanh không gắn hóa đơn (vd lịch sử KiotViet)
  orderId: uuid("order_id").references(() => orders.id),
  customerId: uuid("customer_id").references(() => customers.id),
  warehouseId: uuid("warehouse_id").references(() => warehouses.id),
  reason: text("reason"),
  refundMethod: refundMethodEnum("refund_method").notNull().default("cash"),
  totalRefund: decimal("total_refund", { precision: 14, scale: 2 }).notNull().default("0"),
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("returns_order_idx").on(t.orderId)]);

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
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("projects_customer_idx").on(t.customerId)]);

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

// ============= Hóa đơn điện tử (stub provider) =============

export const einvoiceStatusEnum = pgEnum("einvoice_status", ["draft", "issued", "error"]);

export const einvoices = pgTable("einvoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id).unique(),
  status: einvoiceStatusEnum("status").notNull().default("draft"),
  serial: varchar("serial", { length: 20 }).notNull().default("1C26TTP"),
  number: varchar("number", { length: 20 }),
  buyerName: text("buyer_name").notNull(),
  buyerTaxCode: varchar("buyer_tax_code", { length: 30 }),
  vatRate: decimal("vat_rate", { precision: 5, scale: 2 }).notNull().default("10"),
  totalBeforeVat: decimal("total_before_vat", { precision: 14, scale: 2 }).notNull().default("0"),
  vatAmount: decimal("vat_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

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
  "order", "quote", "purchase", "return", "receipt",
]);
export const paperSizeEnum = pgEnum("paper_size", ["a4", "a5", "k80"]);

export const printTemplates = pgTable("print_templates", {
  docType: printDocTypeEnum("doc_type").primaryKey(),
  paperDefault: paperSizeEnum("paper_default").notNull().default("a5"),
  storeName: text("store_name").notNull().default(""),
  storeAddress: text("store_address").notNull().default(""),
  storePhone: text("store_phone").notNull().default(""),
  storeTaxCode: text("store_tax_code").notNull().default(""),
  footerNote: text("footer_note").notNull().default(""),
  // toggles: showSeller, showProject, showDebt, showInWords, showSignatures, fontSize...
  options: jsonb("options").$type<Record<string, boolean | string | number>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("shifts_status_idx").on(t.status), index("shifts_user_idx").on(t.userId)]);

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
  status: text("status").notNull().default("pending"), // pending | preparing | ready | served
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("kitchen_ticket_items_ticket_idx").on(t.ticketId)]);

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
