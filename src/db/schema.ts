import {
  pgTable, uuid, text, varchar, integer, decimal, timestamp, date,
  boolean, bigint, jsonb, primaryKey, index, uniqueIndex, pgEnum, check,
  foreignKey, unique,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import type { StorePrefs } from "@/lib/schemas/settings";
import type { ServiceChecklistItem } from "@/lib/services/domain";
import type { MediaProvider, MediaVisibility } from "@/lib/media/types";
import type { MediaFileMetadata } from "@/lib/media/file-metadata-types";

export type ServiceTradeRecordData = Record<string, unknown>;
export type InstalledAssetSpecs = Record<string, unknown>;

function missingStoreId(): string {
  if (process.env.NODE_ENV === "test" && process.env.LUMA_TEST_STORE_ID) {
    return process.env.LUMA_TEST_STORE_ID;
  }
  throw new Error("STORE_ID_REQUIRED");
}

// ============= Enums =============

export const userRoleEnum = pgEnum("user_role", ["owner", "manager", "cashier", "warehouse", "technician"]);
export const storeStatusEnum = pgEnum("store_status", ["active", "suspended", "archived"]);
export const orderStatusEnum = pgEnum("order_status", [
  "draft", "quote", "confirmed", "delivering", "completed", "cancelled", "returned", "merged",
]);
export const orderDocumentTypeEnum = pgEnum("order_document_type", [
  "sale", "quote", "booking",
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
export const productKindEnum = pgEnum("product_kind", [
  "product", "service", "combo",
]);
export const customerConsentStatusEnum = pgEnum("customer_consent_status", [
  "pending", "granted", "withdrawn",
]);
export const customerReceivableReceiptStatusEnum = pgEnum("customer_receivable_receipt_status", [
  "confirmed", "pending_qr", "expired", "cancelled",
]);
export const customerReceivableEntryTypeEnum = pgEnum("customer_receivable_entry_type", [
  "adjustment_debit", "adjustment_credit", "settlement_discount",
]);
export const supplierPayableReceiptStatusEnum = pgEnum("supplier_payable_receipt_status", [
  "confirmed", "cancelled",
]);
export const supplierPayableEntryTypeEnum = pgEnum("supplier_payable_entry_type", [
  "adjustment_debit", "adjustment_credit",
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

// ============= Stores =============

export const stores = pgTable("stores", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  status: storeStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============= Users (linked to Supabase auth.users) =============

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  fullName: text("full_name").notNull(),
  phone: varchar("phone", { length: 20 }),
  phoneNormalized: text("phone_normalized"),
  role: userRoleEnum("role").notNull().default("cashier"),
  isActive: boolean("is_active").notNull().default(true),
  cashierPinHash: text("cashier_pin_hash"),
  cashierPinFailedAttempts: integer("cashier_pin_failed_attempts").notNull().default(0),
  cashierPinLockedUntil: timestamp("cashier_pin_locked_until", { withTimezone: true }),
  cashierPinUpdatedAt: timestamp("cashier_pin_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("profiles_store_active_role_idx").on(t.storeId, t.isActive, t.role),
  uniqueIndex("profiles_phone_normalized_unique")
    .on(t.phoneNormalized)
    .where(sql`${t.phoneNormalized} is not null`),
  unique("profiles_store_id_id_unique").on(t.storeId, t.id),
]);

// ============= Canonical media registry =============

export const mediaObjects = pgTable("media_objects", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id, { onDelete: "cascade" }),
  provider: text("provider").$type<MediaProvider>().notNull().default("r2"),
  visibility: text("visibility").$type<MediaVisibility>().notNull(),
  purpose: text("purpose").$type<"product-image" | "project-document" | "service-evidence" | "ai-attachment" | "library-asset">().notNull(),
  targetId: uuid("target_id").notNull(),
  domain: text("domain").notNull(),
  bucket: text("bucket").notNull(),
  objectKey: text("object_key").notNull(),
  originalFileName: text("original_file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: varchar("sha256", { length: 64 }),
  width: integer("width"),
  height: integer("height"),
  thumbnailObjectKey: text("thumbnail_object_key"),
  thumbnailSizeBytes: bigint("thumbnail_size_bytes", { mode: "number" }),
  status: text("status").$type<"pending" | "ready" | "quarantined" | "deleted">().notNull().default("pending"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  uploadExpiresAt: timestamp("upload_expires_at", { withTimezone: true }).notNull(),
  readyAt: timestamp("ready_at", { withTimezone: true }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  cleanupClaimedAt: timestamp("cleanup_claimed_at", { withTimezone: true }),
  cleanupClaimToken: uuid("cleanup_claim_token"),
  cleanupAttempts: integer("cleanup_attempts").notNull().default(0),
  cleanupLastError: text("cleanup_last_error"),
  storageDeletedAt: timestamp("storage_deleted_at", { withTimezone: true }),
  legacyBucket: text("legacy_bucket"),
  legacyPath: text("legacy_path"),
  legacyUrl: text("legacy_url"),
}, (t) => [
  check("media_objects_provider_check", sql`${t.provider} in ('r2', 'supabase')`),
  check("media_objects_visibility_check", sql`${t.visibility} in ('public', 'private')`),
  check("media_objects_purpose_check", sql`${t.purpose} in ('product-image', 'project-document', 'service-evidence', 'ai-attachment', 'library-asset')`),
  check("media_objects_status_check", sql`${t.status} in ('pending', 'ready', 'quarantined', 'deleted')`),
  check("media_objects_size_check", sql`${t.sizeBytes} > 0`),
  check("media_objects_cleanup_claim_check", sql`(${t.cleanupClaimedAt} is null) = (${t.cleanupClaimToken} is null)`),
  check("media_objects_cleanup_attempts_check", sql`${t.cleanupAttempts} >= 0`),
  unique("media_objects_location_unique").on(t.provider, t.bucket, t.objectKey),
  unique("media_objects_store_id_id_unique").on(t.storeId, t.id),
  index("media_objects_store_purpose_target_idx").on(t.storeId, t.purpose, t.targetId),
  index("media_objects_status_upload_expiry_idx").on(t.status, t.uploadExpiresAt),
  index("media_objects_cleanup_retry_idx").on(t.status, t.storageDeletedAt, t.cleanupClaimedAt, t.uploadExpiresAt, t.deletedAt),
  index("media_objects_store_status_domain_idx").on(t.storeId, t.status, t.domain, t.createdAt),
  index("media_objects_store_created_by_idx")
    .on(t.storeId, t.createdBy)
    .where(sql`${t.createdBy} is not null`),
  foreignKey({
    columns: [t.storeId, t.createdBy],
    foreignColumns: [profiles.storeId, profiles.id],
    name: "media_objects_created_by_tenant_fk",
  }).onDelete("no action"),
]);

// Server-only: construction GPS must not inherit media_objects' store-wide grants.
export const mediaFileMetadata = pgTable("media_file_metadata", {
  storeId: uuid("store_id").notNull(),
  mediaObjectId: uuid("media_object_id").notNull(),
  metadata: jsonb("metadata").$type<MediaFileMetadata>().notNull(),
}, (t) => [
  primaryKey({ name: "media_file_metadata_pkey", columns: [t.storeId, t.mediaObjectId] }),
  foreignKey({
    columns: [t.storeId, t.mediaObjectId],
    foreignColumns: [mediaObjects.storeId, mediaObjects.id],
    name: "media_file_metadata_object_tenant_fk",
  }).onDelete("cascade"),
  check("media_file_metadata_json_check", sql`coalesce((
    jsonb_typeof(${t.metadata}) = 'object'
    and ${t.metadata}->'version' = '1'::jsonb
    and ${t.metadata}->>'status' in ('ready', 'empty', 'unsupported', 'failed')
    and jsonb_typeof(${t.metadata}->'extractedAt') = 'string'
    and octet_length(${t.metadata}::text) <= 16384
    and ${t.metadata} ?& array['version', 'status', 'extractedAt']
  ), false)`),
]);

export const mediaLibraryItems = pgTable("media_library_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id, { onDelete: "cascade" }),
  mediaObjectId: uuid("media_object_id").notNull(),
  album: text("album").notNull().default("Chưa phân loại"),
  title: text("title").notNull(),
  note: text("note"),
  tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  check("media_library_items_album_check", sql`char_length(btrim(${t.album})) between 1 and 80`),
  check("media_library_items_title_check", sql`char_length(btrim(${t.title})) between 1 and 160`),
  check("media_library_items_note_check", sql`${t.note} is null or char_length(${t.note}) <= 500`),
  check("media_library_items_tags_check", sql`cardinality(${t.tags}) <= 12`),
  unique("media_library_items_media_unique").on(t.storeId, t.mediaObjectId),
  index("media_library_items_store_album_created_idx")
    .on(t.storeId, t.album, t.createdAt)
    .where(sql`${t.deletedAt} is null`),
  index("media_library_items_store_media_idx").on(t.storeId, t.mediaObjectId),
  foreignKey({
    columns: [t.storeId, t.mediaObjectId],
    foreignColumns: [mediaObjects.storeId, mediaObjects.id],
    name: "media_library_items_media_tenant_fk",
  }).onDelete("no action"),
  foreignKey({
    columns: [t.storeId, t.createdBy],
    foreignColumns: [profiles.storeId, profiles.id],
    name: "media_library_items_created_by_tenant_fk",
  }).onDelete("no action"),
]);

export const storeFeatures = pgTable("store_features", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id, { onDelete: "cascade" }),
  featureKey: text("feature_key").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  updatedBy: uuid("updated_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.storeId, t.featureKey] }),
  index("store_features_enabled_idx").on(t.storeId, t.enabled),
]);

export const staffInvitations = pgTable("staff_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id, { onDelete: "cascade" }),
  email: text("email"),
  phoneNormalized: text("phone_normalized"),
  role: userRoleEnum("role").notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  invitedBy: uuid("invited_by").notNull().references(() => profiles.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("staff_invitations_store_created_idx").on(t.storeId, t.createdAt),
  index("staff_invitations_store_email_idx").on(t.storeId, t.email),
  foreignKey({
    columns: [t.storeId, t.invitedBy],
    foreignColumns: [profiles.storeId, profiles.id],
    name: "staff_invitations_store_inviter_fk",
  }),
  check("staff_invitations_contact_check", sql`${t.email} is not null or ${t.phoneNormalized} is not null`),
]);

export const mobileApprovals = pgTable("mobile_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id, { onDelete: "cascade" }),
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
  index("mobile_approvals_store_requester_idx").on(t.storeId, t.requesterId, t.createdAt),
  index("mobile_approvals_expiry_idx").on(t.expiresAt),
  foreignKey({
    columns: [t.storeId, t.requesterId],
    foreignColumns: [profiles.storeId, profiles.id],
    name: "mobile_approvals_store_requester_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [t.storeId, t.approverId],
    foreignColumns: [profiles.storeId, profiles.id],
    name: "mobile_approvals_store_approver_fk",
  }).onDelete("cascade"),
]);

// ============= General Audit Log =============

export const auditLogs = pgTable("audit_logs", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").references(() => profiles.id),
  surface: text("surface").notNull().default("web"),
  title: text("title").notNull().default("AI Assistant"),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  unique("ai_chat_sessions_store_id_id_unique").on(t.storeId, t.id),
  index("ai_chat_sessions_owner_idx").on(t.ownerId, t.updatedAt),
  index("ai_chat_sessions_surface_idx").on(t.surface, t.updatedAt),
]);

export const aiChatMessages = pgTable("ai_chat_messages", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  check("ai_chat_messages_attachments_shape_check", sql`public.is_valid_ai_attachment_document(${t.attachments})`),
  index("ai_chat_messages_session_idx").on(t.sessionId, t.createdAt),
  foreignKey({
    columns: [t.storeId, t.sessionId],
    foreignColumns: [aiChatSessions.storeId, aiChatSessions.id],
    name: "ai_chat_messages_session_tenant_fk",
  }).onDelete("cascade"),
]);

// ============= Categories =============

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("categories_store_name_unique").on(t.storeId, t.name),
  index("categories_parent_idx").on(t.parentId),
]);

// ============= Brands =============

export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  logoMediaObjectId: uuid("logo_media_object_id"),
}, (t) => [
  uniqueIndex("brands_store_name_unique").on(t.storeId, t.name),
  index("brands_logo_media_object_idx").on(t.logoMediaObjectId).where(sql`${t.logoMediaObjectId} is not null`),
  foreignKey({
    columns: [t.storeId, t.logoMediaObjectId],
    foreignColumns: [mediaObjects.storeId, mediaObjects.id],
    name: "brands_logo_media_object_tenant_fk",
  }).onDelete("no action"),
]);

// ============= Price books (bảng giá động) =============
// Bảng giá mặc định (isDefault) đọc products.retailPrice. Bảng khác lưu override
// trong product_prices; thiếu override thì fallback về retailPrice.

export const priceBooks = pgTable("price_books", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  // Bảng giá nội bộ (ví dụ giá nhập) chỉ owner/manager được chọn khi bán hàng.
  managerOnly: boolean("manager_only").notNull().default(false),
  // Bảng giá vốn luôn lấy products.costPrice hiện tại, không dùng giá override tĩnh.
  costBased: boolean("cost_based").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("price_books_store_default_unique").on(t.storeId).where(sql`${t.isDefault} = true`),
]);

export const productPrices = pgTable("product_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  name: text("name").notNull(),
  address: text("address"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("warehouses_store_default_unique").on(t.storeId).where(sql`${t.isDefault} = true`),
]);

// ============= Products =============
// 1 product = 1 SKU. Variants are separate products linked by parent_id
// (gạch 60×60 đỏ matte vs 60×60 đỏ bóng = 2 products)

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  sku: varchar("sku", { length: 50 }).notNull(),
  barcode: varchar("barcode", { length: 50 }),
  name: text("name").notNull(),
  productKind: productKindEnum("product_kind").notNull().default("product"),
  fullName: text("full_name"), // "Gạch granite Viglacera 60x60 Đỏ Matte"
  relatedProductId: uuid("related_product_id").references((): AnyPgColumn => products.id, { onDelete: "set null" }),
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
  imageUpdatedAt: timestamp("image_updated_at", { withTimezone: true }).defaultNow().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("products_store_sku_unique").on(t.storeId, t.sku),
  unique("products_store_id_id_unique").on(t.storeId, t.id),
  index("products_sku_idx").on(t.sku),
  index("products_barcode_idx").on(t.barcode),
  index("products_name_idx").on(t.name),
  index("products_category_idx").on(t.categoryId),
  index("products_related_idx").on(t.relatedProductId),
  index("products_parent_idx").on(t.parentProductId),
  index("products_variant_parent_idx").on(t.isVariantParent, t.parentProductId),
  index("products_lifecycle_status_idx").on(t.lifecycleStatus),
  // danh sách SP lọc đang bán + sắp theo ngày tạo (trang Sản phẩm/Thiết lập giá)
  index("products_active_created_idx").on(t.isActive, t.createdAt),
  index("products_total_stock_idx").on(t.totalStock), // lọc/sắp theo tồn (trang Tồn kho)
]);

// Catalog names and aliases preserve attribute identity across renames/imports.
// Product-spec triggers maintain usage, so even legacy writers respect deletion.
export const productVariantGroups = pgTable("product_variant_groups", {
  storeId: uuid("store_id").notNull(),
  id: uuid("id").notNull(),
  kind: text("kind").notNull(),
  attributes: jsonb("attributes").$type<import("@/lib/products/variant-model").NormalizedVariantAttribute[]>().notNull().default([]),
  excludedCombinationKeys: jsonb("excluded_combination_keys").$type<string[]>().notNull().default([]),
  requiresReview: boolean("requires_review").notNull().default(false),
  revision: integer("revision").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.storeId, t.id] }),
  foreignKey({ columns: [t.storeId, t.id], foreignColumns: [products.storeId, products.id] }).onDelete("cascade"),
  check("product_variant_groups_kind_check", sql`${t.kind} in ('native','related')`),
]);

export const productVariantMembers = pgTable("product_variant_members", {
  storeId: uuid("store_id").notNull(), groupId: uuid("group_id").notNull(), productId: uuid("product_id").notNull(),
  combinationKey: text("combination_key"), optionValueIds: jsonb("option_value_ids").$type<string[]>().notNull().default([]),
}, (t) => [primaryKey({ columns: [t.storeId, t.productId] }),
  foreignKey({ columns: [t.storeId, t.groupId], foreignColumns: [productVariantGroups.storeId, productVariantGroups.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }).onDelete("cascade"),
  unique("product_variant_members_combination_unique").on(t.storeId, t.groupId, t.combinationKey),
]);

export const productAttributes = pgTable("product_attributes", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  nameKey: text("name_key").generatedAlwaysAs(sql`public.product_attribute_name_key(name)`),
}, (t) => [
  unique("product_attributes_store_name_unique").on(t.storeId, t.nameKey),
  unique("product_attributes_store_id_unique").on(t.storeId, t.id),
  check("product_attributes_name_check", sql`${t.nameKey} <> '' and left(${t.nameKey}, 2) <> '__'`),
]);

export const productVariantGroupAttributes = pgTable("product_variant_group_attributes", {
  storeId: uuid("store_id").notNull(), groupId: uuid("group_id").notNull(), attributeId: uuid("attribute_id").notNull(),
}, (t) => [primaryKey({ columns: [t.storeId, t.groupId, t.attributeId] }),
  foreignKey({ columns: [t.storeId, t.groupId], foreignColumns: [productVariantGroups.storeId, productVariantGroups.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.storeId, t.attributeId], foreignColumns: [productAttributes.storeId, productAttributes.id] }).onDelete("restrict"),
  index("product_variant_group_attributes_usage_idx").on(t.storeId, t.attributeId),
]);

export const productVariantRequests = pgTable("product_variant_requests", {
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  requestId: uuid("request_id").notNull(), payloadHash: text("payload_hash").notNull(), groupId: uuid("group_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.storeId, t.requestId] }),
  foreignKey({ columns: [t.storeId, t.groupId], foreignColumns: [productVariantGroups.storeId, productVariantGroups.id] }).onDelete("cascade"),
  index("product_variant_requests_group_idx").on(t.storeId, t.groupId),
]);

export const productAttributeAliases = pgTable("product_attribute_aliases", {
  storeId: uuid("store_id").notNull(),
  nameKey: text("name_key").notNull(),
  attributeId: uuid("attribute_id").notNull(),
}, (t) => [
  primaryKey({ columns: [t.storeId, t.nameKey] }),
  index("product_attribute_aliases_attribute_idx").on(t.storeId, t.attributeId),
  foreignKey({ columns: [t.storeId, t.attributeId], foreignColumns: [productAttributes.storeId, productAttributes.id], name: "product_attribute_aliases_attribute_fk" }).onDelete("cascade"),
]);

export const productAttributeProducts = pgTable("product_attribute_products", {
  storeId: uuid("store_id").notNull(),
  productId: uuid("product_id").notNull(),
  attributeId: uuid("attribute_id").notNull(),
}, (t) => [
  primaryKey({ columns: [t.storeId, t.productId, t.attributeId] }),
  index("product_attribute_products_usage_idx").on(t.storeId, t.attributeId),
  foreignKey({ columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id], name: "product_attribute_products_product_fk" }).onDelete("cascade"),
  foreignKey({ columns: [t.storeId, t.attributeId], foreignColumns: [productAttributes.storeId, productAttributes.id], name: "product_attribute_products_attribute_fk" }).onDelete("restrict"),
]);

export const productMedia = pgTable("product_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull(),
  mediaObjectId: uuid("media_object_id").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  unique("product_media_product_unique").on(t.productId, t.mediaObjectId),
  check("product_media_sort_order_check", sql`${t.sortOrder} >= 0`),
  uniqueIndex("product_media_active_primary_unique")
    .on(t.productId)
    .where(sql`${t.isPrimary} = true and ${t.deletedAt} is null`),
  index("product_media_store_product_order_idx")
    .on(t.storeId, t.productId, t.sortOrder)
    .where(sql`${t.deletedAt} is null`),
  index("product_media_store_media_object_idx").on(t.storeId, t.mediaObjectId),
  foreignKey({
    columns: [t.storeId, t.productId],
    foreignColumns: [products.storeId, products.id],
    name: "product_media_product_tenant_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [t.storeId, t.mediaObjectId],
    foreignColumns: [mediaObjects.storeId, mediaObjects.id],
    name: "product_media_object_tenant_fk",
  }).onDelete("no action"),
]);

// ============= Product Units (multi đơn vị tính) =============
// Ví dụ gạch: base unit = viên, 1 hộp = 11 viên, 1 m² = 2.78 viên
//   → 2 rows: { unit: "hộp", multiplier: 11 }, { unit: "m²", multiplier: 2.78 }

export const productUnits = pgTable("product_units", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  sku: varchar("sku", { length: 50 }),
  unitName: varchar("unit_name", { length: 30 }).notNull(), // hộp, m², thùng, pallet
  multiplier: decimal("multiplier", { precision: 14, scale: 4 }).notNull(), // 1 unitName = N base units
  barcode: varchar("barcode", { length: 50 }),
  priceOverride: decimal("price_override", { precision: 14, scale: 2 }),
  sortOrder: integer("sort_order").default(0),
}, (t) => [
  index("product_units_product_idx").on(t.productId),
  uniqueIndex("product_units_store_sku_idx")
    .on(t.storeId, t.sku)
    .where(sql`${t.sku} is not null`),
]);

// Stable ownership mapping for server-side imports and synchronization.
export const productSourceMappings = pgTable("product_source_mappings", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id, { onDelete: "cascade" }),
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull(),
  provider: varchar("provider", { length: 30 }).notNull(),
  externalId: varchar("external_id", { length: 100 }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("product_source_mappings_store_external_idx")
    .on(t.storeId, t.provider, t.externalId),
  uniqueIndex("product_source_mappings_store_product_idx")
    .on(t.storeId, t.provider, t.productId),
  foreignKey({
    columns: [t.storeId, t.productId],
    foreignColumns: [products.storeId, products.id],
    name: "product_source_mappings_product_tenant_fk",
  }).onDelete("cascade"),
]);

// ============= KiotViet controlled data synchronization =============

export const kiotvietSyncRuns = pgTable("kiotviet_sync_runs", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id, { onDelete: "cascade" }),
  id: uuid("id").primaryKey().defaultRandom(),
  provider: varchar("provider", { length: 30 }).notNull().default("kiotviet"),
  phase: varchar("phase", { length: 30 }).notNull(),
  sourceFileName: text("source_file_name").notNull(),
  sourceSha256: varchar("source_sha256", { length: 64 }).notNull(),
  bundleSha256: varchar("bundle_sha256", { length: 64 }),
  sourceRows: integer("source_rows").notNull().default(0),
  sourceDocuments: integer("source_documents").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default("running"),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
  errorDetails: jsonb("error_details").$type<Record<string, unknown>>(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  unique("kiotviet_sync_runs_store_id_id_unique").on(t.storeId, t.id),
  check("kiotviet_sync_runs_source_sha256_check", sql`${t.sourceSha256} ~ '^[0-9a-f]{64}$'`),
  check("kiotviet_sync_runs_counts_check", sql`${t.sourceRows} >= 0 and ${t.sourceDocuments} >= 0`),
  check("kiotviet_sync_runs_status_check", sql`${t.status} in ('running', 'completed', 'failed', 'rolled_back')`),
  index("kiotviet_sync_runs_store_status_idx").on(t.storeId, t.status, t.startedAt),
]);

export const kiotvietSourceMappings = pgTable("kiotviet_source_mappings", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id, { onDelete: "cascade" }),
  id: uuid("id").primaryKey().defaultRandom(),
  provider: varchar("provider", { length: 30 }).notNull().default("kiotviet"),
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  externalId: varchar("external_id", { length: 160 }).notNull(),
  localId: uuid("local_id").notNull(),
  sourceSha256: varchar("source_sha256", { length: 64 }).notNull(),
  adoptionMethod: varchar("adoption_method", { length: 24 }).notNull(),
  lastSeenRunId: uuid("last_seen_run_id").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("kiotviet_source_mappings_store_external_idx")
    .on(t.storeId, t.provider, t.entityType, t.externalId),
  uniqueIndex("kiotviet_source_mappings_store_local_idx")
    .on(t.storeId, t.provider, t.entityType, t.localId),
  index("kiotviet_source_mappings_store_run_idx").on(t.storeId, t.lastSeenRunId),
  check("kiotviet_source_mappings_source_sha256_check", sql`${t.sourceSha256} ~ '^[0-9a-f]{64}$'`),
  check("kiotviet_source_mappings_adoption_method_check", sql`${t.adoptionMethod} in ('mapped', 'created', 'legacy_adopted')`),
  check("kiotviet_source_mappings_entity_type_check", sql`${t.entityType} in ('customer', 'supplier', 'booking', 'booking_line', 'booking_payment', 'sale', 'sale_line', 'sale_payment', 'purchase', 'purchase_line', 'customer_return', 'customer_return_line', 'supplier_return', 'supplier_return_line')`),
  foreignKey({
    columns: [t.storeId, t.lastSeenRunId],
    foreignColumns: [kiotvietSyncRuns.storeId, kiotvietSyncRuns.id],
    name: "kiotviet_source_mappings_run_tenant_fk",
  }).onDelete("restrict"),
]);

// Thành phần của combo. quantity luôn tính theo đơn vị cơ bản của sản phẩm con.
export const productComboItems = pgTable("product_combo_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  comboProductId: uuid("combo_product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  componentProductId: uuid("component_product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull().default("1"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("product_combo_items_unique").on(t.comboProductId, t.componentProductId),
  index("product_combo_items_combo_idx").on(t.comboProductId),
  index("product_combo_items_component_idx").on(t.componentProductId),
  check("product_combo_items_not_self", sql`${t.comboProductId} <> ${t.componentProductId}`),
  check("product_combo_items_quantity_positive", sql`${t.quantity} > 0`),
]);

// 1 sản phẩm mua được từ NHIỀU nhà cung cấp (products.supplierId = NCC chính)
export const productSuppliers = pgTable("product_suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "cascade" }),
  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull().default("0"), // base unit
  reserved: decimal("reserved", { precision: 14, scale: 4 }).notNull().default("0"), // đã đặt cọc
  minLevel: decimal("min_level", { precision: 14, scale: 4 }).default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.storeId, t.productId, t.warehouseId] })]);

// One revision row per store, advanced by DB triggers whenever that store's
// offline Product Catalog projection changes.
export const catalogSyncState = pgTable("catalog_sync_state", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id, { onDelete: "cascade" }),
  id: integer("id").notNull(),
  revision: bigint("revision", { mode: "number" }).notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.storeId, t.id] }),
  check("catalog_sync_state_singleton_check", sql`${t.id} = 1`),
]);

// ============= Stock Movements (audit) =============

export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  code: varchar("code", { length: 30 }), // KH001
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
  uniqueIndex("customers_store_code_unique").on(t.storeId, t.code).where(sql`${t.code} is not null`),
  index("customers_phone_idx").on(t.phone),
  index("customers_zalo_user_id_idx").on(t.zaloUserId),
  index("customers_name_idx").on(t.name),
]);

// ============= Customer PDPL Consent =============

export const customerConsents = pgTable("customer_consents", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  effectiveUserId: uuid("effective_user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  deviceId: varchar("device_id", { length: 120 }).notNull(),
  platform: varchar("platform", { length: 20 }).notNull(),
  token: text("token").notNull().unique(),
  permission: varchar("permission", { length: 20 }).notNull().default("authorized"),
  enabled: boolean("enabled").notNull().default(true),
  locale: varchar("locale", { length: 20 }),
  bindingGeneration: bigint("binding_generation", { mode: "number" }).notNull().default(0),
  sendLeaseId: uuid("send_lease_id"),
  sendLeaseGeneration: bigint("send_lease_generation", { mode: "number" }),
  sendLeaseExpiresAt: timestamp("send_lease_expires_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("mobile_push_devices_user_device_idx").on(t.userId, t.deviceId),
  index("mobile_push_devices_user_enabled_idx").on(t.userId, t.enabled),
  index("mobile_push_devices_effective_user_enabled_idx").on(t.effectiveUserId, t.enabled),
]);

export const mobilePushDeviceBindingFences = pgTable("mobile_push_device_binding_fences", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  deviceId: varchar("device_id", { length: 120 }).notNull(),
  bindingGeneration: bigint("binding_generation", { mode: "number" }).notNull().default(0),
  active: boolean("active").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.deviceId] }),
]);

export const mobilePushDeliveries = pgTable("mobile_push_deliveries", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: uuid("device_id").notNull().references(() => mobilePushDevices.id, { onDelete: "cascade" }),
  notificationKey: varchar("notification_key", { length: 180 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  attempts: integer("attempts").notNull().default(1),
  errorCode: varchar("error_code", { length: 80 }),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).defaultNow().notNull(),
  claimToken: uuid("claim_token"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("mobile_push_deliveries_device_notification_idx")
    .on(t.deviceId, t.notificationKey),
  index("mobile_push_deliveries_status_idx").on(t.status, t.attemptedAt),
  index("mobile_push_deliveries_claim_idx").on(t.status, t.claimedAt)
    .where(sql`${t.status} = 'sending'`),
]);

export const notificationEvents = pgTable("notification_events", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  eventKey: varchar("event_key", { length: 200 }).notNull(),
  category: varchar("category", { length: 40 }).notNull(),
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  entityId: uuid("entity_id").notNull(),
  actorId: uuid("actor_id").references(() => profiles.id, { onDelete: "set null" }),
  target: varchar("target", { length: 40 }).notNull(),
  priority: varchar("priority", { length: 16 }).notNull(),
  quietHoursPolicy: varchar("quiet_hours_policy", { length: 16 }).notNull(),
  contractVersion: integer("contract_version").notNull().default(1),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("notification_events_store_event_key_unique").on(t.storeId, t.eventKey),
  index("notification_events_category_created_idx").on(t.category, t.createdAt),
]);

export const notificationRecipients = pgTable("notification_recipients", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => notificationEvents.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  reason: varchar("reason", { length: 16 }).notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("notification_recipients_event_user_unique").on(t.eventId, t.userId),
  index("notification_recipients_user_created_idx").on(t.userId, t.createdAt),
]);

export const notificationOutbox = pgTable("notification_outbox", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().unique().references(() => notificationEvents.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  provider: varchar("provider", { length: 32 }),
  providerMessageId: varchar("provider_message_id", { length: 180 }),
  attemptCount: integer("attempt_count").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  lastErrorCode: varchar("last_error_code", { length: 80 }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("notification_outbox_status_available_idx").on(t.status, t.availableAt),
]);

export const mobileTelemetryEvents = pgTable("mobile_telemetry_events", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  code: varchar("code", { length: 30 }),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  taxCode: varchar("tax_code", { length: 30 }),
  currentDebt: decimal("current_debt", { precision: 14, scale: 2 }).notNull().default("0"),
  note: text("note"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("suppliers_store_code_unique").on(t.storeId, t.code).where(sql`${t.code} is not null`),
]);

// ============= Payment providers / bank accounts =============

export const paymentBankAccounts = pgTable("payment_bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  code: varchar("code", { length: 30 }).notNull(), // HD20260506-001
  // Khử trùng đơn khi đồng bộ offline: mỗi đơn từ POS có 1 clientId; sync lại
  // không tạo đơn trùng (unique). Xem supabase/order-client-id.sql.
  clientId: varchar("client_id", { length: 40 }),
  status: orderStatusEnum("status").notNull().default("draft"),
  documentType: orderDocumentTypeEnum("document_type").notNull().default("sale"),
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
  uniqueIndex("orders_store_code_unique").on(t.storeId, t.code),
  uniqueIndex("orders_store_client_id_unique").on(t.storeId, t.clientId).where(sql`${t.clientId} is not null`),
  index("orders_status_idx").on(t.status),
  index("orders_document_type_status_idx").on(t.documentType, t.status),
  index("orders_customer_idx").on(t.customerId),
  index("orders_created_idx").on(t.createdAt),
  index("orders_shift_idx").on(t.shiftId),
  index("orders_source_idx").on(t.sourceOrderId),
  index("orders_replaced_by_idx").on(t.replacedByOrderId),
]);

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  productName: text("product_name").notNull(), // snapshot
  unitName: varchar("unit_name", { length: 30 }).notNull(), // unit dùng khi bán
  unitMultiplier: decimal("unit_multiplier", { precision: 14, scale: 4 }).notNull(), // snapshot
  sourceSku: varchar("source_sku", { length: 50 }), // KiotViet historical source-unit SKU snapshot
  // Nguồn bảng giá của dòng; null = Giá Chung, null field ở bản ghi cũ = không lưu nguồn.
  priceBookId: uuid("price_book_id").references(() => priceBooks.id, { onDelete: "set null" }),

  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 14, scale: 2 }).notNull(),
  discount: decimal("discount", { precision: 14, scale: 2 }).notNull().default("0"),
  total: decimal("total", { precision: 14, scale: 2 }).notNull(),
  note: text("note"),
}, (t) => [index("order_items_order_idx").on(t.orderId)]);

// ============= Payments (đặt cọc, thanh toán nhiều đợt) =============

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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

// ============= Customer receivables =============

/** One debt-collection receipt may be allocated across several invoices. */
export const customerReceivableReceipts = pgTable("customer_receivable_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  code: varchar("code", { length: 40 }).notNull(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  status: customerReceivableReceiptStatusEnum("status").notNull().default("confirmed"),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  method: paymentMethodEnum("method").notNull(),
  reference: text("reference"),
  note: text("note"),
  clientRequestId: varchar("client_request_id", { length: 80 }).notNull(),
  createdBy: uuid("created_by").references(() => profiles.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("customer_receivable_receipts_store_code_unique").on(t.storeId, t.code),
  uniqueIndex("customer_receivable_receipts_store_client_unique").on(t.storeId, t.clientRequestId),
  index("customer_receivable_receipts_customer_idx").on(t.customerId, t.createdAt),
  index("customer_receivable_receipts_status_idx").on(t.status, t.createdAt),
]);

export const customerReceivableAllocations = pgTable("customer_receivable_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  receiptId: uuid("receipt_id").notNull().references(() => customerReceivableReceipts.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  paymentId: uuid("payment_id").references(() => payments.id),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("customer_receivable_allocations_receipt_order_idx").on(t.receiptId, t.orderId),
  index("customer_receivable_allocations_order_idx").on(t.orderId),
]);

/** Adjustment and settlement-discount entries: positive raises debt, negative lowers it. */
export const customerReceivableEntries = pgTable("customer_receivable_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  code: varchar("code", { length: 40 }).notNull(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  orderId: uuid("order_id").references(() => orders.id),
  type: customerReceivableEntryTypeEnum("type").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  reference: text("reference"),
  note: text("note"),
  clientRequestId: varchar("client_request_id", { length: 80 }).notNull(),
  createdBy: uuid("created_by").references(() => profiles.id),
  approvedBy: uuid("approved_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("customer_receivable_entries_store_code_unique").on(t.storeId, t.code),
  uniqueIndex("customer_receivable_entries_store_client_unique").on(t.storeId, t.clientRequestId),
  index("customer_receivable_entries_customer_idx").on(t.customerId, t.createdAt),
  index("customer_receivable_entries_order_idx").on(t.orderId),
]);

export const paymentWebhookEvents = pgTable("payment_webhook_events", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  code: varchar("code", { length: 30 }).notNull(),
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
}, (t) => [uniqueIndex("purchase_orders_store_code_unique").on(t.storeId, t.code)]);

export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  productName: text("product_name"),
  sku: varchar("sku", { length: 50 }),
  unitName: varchar("unit_name", { length: 30 }),
  unitMultiplier: decimal("unit_multiplier", { precision: 14, scale: 4 }).notNull().default("1"),
  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull(),
  unitCost: decimal("unit_cost", { precision: 14, scale: 2 }).notNull(),
  discount: decimal("discount", { precision: 14, scale: 2 }).notNull().default("0"), // giảm giá dòng
  total: decimal("total", { precision: 14, scale: 2 }).notNull(),
  batchNumber: varchar("batch_number", { length: 80 }),
  expiryDate: date("expiry_date"),
});

// ============= Supplier payables =============

/** One supplier payment may be allocated across several purchase receipts. */
export const supplierPayableReceipts = pgTable("supplier_payable_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  code: varchar("code", { length: 40 }).notNull(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  status: supplierPayableReceiptStatusEnum("status").notNull().default("confirmed"),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  method: paymentMethodEnum("method").notNull(),
  reference: text("reference"),
  note: text("note"),
  clientRequestId: varchar("client_request_id", { length: 80 }).notNull(),
  createdBy: uuid("created_by").references(() => profiles.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("supplier_payable_receipts_store_code_unique").on(t.storeId, t.code),
  uniqueIndex("supplier_payable_receipts_store_client_unique").on(t.storeId, t.clientRequestId),
  index("supplier_payable_receipts_supplier_idx").on(t.supplierId, t.createdAt),
  index("supplier_payable_receipts_status_idx").on(t.status, t.createdAt),
  check("supplier_payable_receipts_amount_check", sql`${t.amount} > 0`),
]);

export const supplierPayableAllocations = pgTable("supplier_payable_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  receiptId: uuid("receipt_id").notNull().references(() => supplierPayableReceipts.id, { onDelete: "cascade" }),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("supplier_payable_allocations_receipt_purchase_idx").on(t.receiptId, t.purchaseOrderId),
  index("supplier_payable_allocations_purchase_idx").on(t.purchaseOrderId),
  check("supplier_payable_allocations_amount_check", sql`${t.amount} > 0`),
]);

/** Manual debt movement: positive raises payable debt, negative lowers it. */
export const supplierPayableEntries = pgTable("supplier_payable_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  code: varchar("code", { length: 40 }).notNull(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id),
  type: supplierPayableEntryTypeEnum("type").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  reference: text("reference"),
  note: text("note"),
  clientRequestId: varchar("client_request_id", { length: 80 }).notNull(),
  createdBy: uuid("created_by").references(() => profiles.id),
  approvedBy: uuid("approved_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("supplier_payable_entries_store_code_unique").on(t.storeId, t.code),
  uniqueIndex("supplier_payable_entries_store_client_unique").on(t.storeId, t.clientRequestId),
  index("supplier_payable_entries_supplier_idx").on(t.supplierId, t.createdAt),
  index("supplier_payable_entries_purchase_idx").on(t.purchaseOrderId),
  check("supplier_payable_entries_amount_check", sql`${t.amount} <> 0`),
]);

// ============= Stock lots (batch / expiry ledger) =============

export const stockLots = pgTable("stock_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  code: varchar("code", { length: 30 }).notNull(),
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
  uniqueIndex("purchase_returns_store_code_unique").on(t.storeId, t.code),
  index("purchase_returns_purchase_idx").on(t.purchaseOrderId),
  index("purchase_returns_supplier_idx").on(t.supplierId, t.createdAt),
  index("purchase_returns_created_idx").on(t.createdAt),
]);

export const purchaseReturnItems = pgTable("purchase_return_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  purchaseReturnId: uuid("purchase_return_id").notNull().references(() => purchaseReturns.id, { onDelete: "cascade" }),
  purchaseOrderItemId: uuid("purchase_order_item_id").references(() => purchaseOrderItems.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  productName: text("product_name").notNull(),
  sku: varchar("sku", { length: 50 }).notNull(),
  unitName: varchar("unit_name", { length: 30 }).notNull(),
  unitMultiplier: decimal("unit_multiplier", { precision: 14, scale: 4 }).notNull().default("1"),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  code: varchar("code", { length: 30 }).notNull(), // TH-...
  clientId: varchar("client_id", { length: 80 }),
  // nullable: trả hàng nhanh không gắn hóa đơn (vd lịch sử KiotViet)
  orderId: uuid("order_id").references(() => orders.id),
  customerId: uuid("customer_id").references(() => customers.id),
  warehouseId: uuid("warehouse_id").references(() => warehouses.id),
  reason: text("reason"),
  refundMethod: refundMethodEnum("refund_method").notNull().default("cash"),
  totalRefund: decimal("total_refund", { precision: 14, scale: 2 }).notNull().default("0"),
  refundAmount: decimal("refund_amount", { precision: 14, scale: 2 }),
  settlementStatus: text("settlement_status"),
  sourceInvoiceCode: varchar("source_invoice_code", { length: 30 }),
  sourceSubtotal: decimal("source_subtotal", { precision: 14, scale: 2 }),
  sourceDiscount: decimal("source_discount", { precision: 14, scale: 2 }),
  sourceTax: decimal("source_tax", { precision: 14, scale: 2 }),
  sourceOtherRefund: decimal("source_other_refund", { precision: 14, scale: 2 }),
  sourceReturnFee: decimal("source_return_fee", { precision: 14, scale: 2 }),
  sourcePaymentSnapshots: jsonb("source_payment_snapshots").$type<Array<{ channel: string; amount: number }>>(),
  status: text("status").notNull().default("completed"), // completed, cancelled
  exchangeOrderId: uuid("exchange_order_id").references(() => orders.id),
  exchangeDifference: decimal("exchange_difference", { precision: 14, scale: 2 }),
  exchangeSettlementMethod: text("exchange_settlement_method"),
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id),
  cancelledBy: uuid("cancelled_by").references(() => profiles.id),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("returns_store_code_unique").on(t.storeId, t.code),
  index("returns_order_idx").on(t.orderId),
  index("returns_exchange_order_idx").on(t.exchangeOrderId),
  index("returns_status_created_idx").on(t.status, t.createdAt),
  uniqueIndex("returns_store_client_id_unique").on(t.storeId, t.clientId).where(sql`${t.clientId} is not null`),
]);

export const returnItems = pgTable("return_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  returnId: uuid("return_id").notNull().references(() => returns.id, { onDelete: "cascade" }),
  orderItemId: uuid("order_item_id").references(() => orderItems.id), // null = trả nhanh
  productId: uuid("product_id").notNull().references(() => products.id),
  productName: text("product_name").notNull(),
  unitName: varchar("unit_name", { length: 30 }).notNull(),
  unitMultiplier: decimal("unit_multiplier", { precision: 14, scale: 4 }).notNull(),
  sourceSku: varchar("source_sku", { length: 50 }),
  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 14, scale: 2 }).notNull(),
  total: decimal("total", { precision: 14, scale: 2 }).notNull(),
  restock: boolean("restock").notNull().default(true), // false = hàng hỏng, không nhập lại kho bán
}, (t) => [index("return_items_return_idx").on(t.returnId)]);

export const paymentRefunds = pgTable("payment_refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  code: varchar("code", { length: 30 }).notNull(), // PT-/PC-
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
  uniqueIndex("cash_transactions_store_code_unique").on(t.storeId, t.code),
  index("cash_tx_created_idx").on(t.createdAt),
  index("cash_tx_shift_idx").on(t.shiftId),
]);

// ============= Công trình / dự án =============

export const projects = pgTable("projects", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
}, (t) => [
  unique("projects_store_id_id_unique").on(t.storeId, t.id),
  index("projects_customer_idx").on(t.customerId),
]);

export const projectNotes = pgTable("project_notes", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id, { onDelete: "cascade" }),
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("project_notes_content_check", sql`char_length(btrim(${t.content})) > 0`),
  unique("project_notes_store_id_id_unique").on(t.storeId, t.id),
  index("project_notes_project_updated_idx").on(t.storeId, t.projectId, t.updatedAt),
  foreignKey({
    columns: [t.storeId, t.projectId],
    foreignColumns: [projects.storeId, projects.id],
    name: "project_notes_project_tenant_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [t.storeId, t.createdBy],
    foreignColumns: [profiles.storeId, profiles.id],
    name: "project_notes_created_by_tenant_fk",
  }).onDelete("no action"),
]);

// ============= Thi công & dịch vụ =============

export const serviceJobs = pgTable("service_jobs", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 30 }).notNull(),
  serviceType: serviceTypeEnum("service_type").notNull(),
  title: text("title").notNull(),
  status: serviceJobStatusEnum("status").notNull().default("new"),
  priority: serviceJobPriorityEnum("priority").notNull().default("normal"),
  assignedTo: uuid("assigned_to").references(() => profiles.id, { onDelete: "set null" }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  description: text("description"),
  checklist: jsonb("checklist").$type<ServiceChecklistItem[]>().notNull().default([]),
  version: integer("version").notNull().default(1),
  checklistVersion: integer("checklist_version").notNull().default(1),
  assetsVersion: integer("assets_version").notNull().default(1),
  quoteOrderId: uuid("quote_order_id").references(() => orders.id, { onDelete: "set null" }),
  materialOrderId: uuid("material_order_id").references(() => orders.id, { onDelete: "set null" }),
  completionNote: text("completion_note"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("service_jobs_store_id_id_unique").on(t.storeId, t.id),
  uniqueIndex("service_jobs_store_code_unique").on(t.storeId, t.code),
  check("service_jobs_version_check", sql`${t.version} > 0 and ${t.checklistVersion} > 0 and ${t.assetsVersion} > 0`),
  index("service_jobs_project_idx").on(t.projectId, t.createdAt),
  index("service_jobs_status_schedule_idx").on(t.status, t.scheduledAt),
  index("service_jobs_assignee_idx").on(t.assignedTo, t.status),
]);

export const serviceJobTradeRecords = pgTable("service_job_trade_records", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => serviceJobs.id, { onDelete: "cascade" }),
  serviceType: serviceTypeEnum("service_type").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  data: jsonb("data").$type<ServiceTradeRecordData>().notNull().default({}),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("service_job_trade_records_job_unique").on(t.jobId),
  check("service_job_trade_records_type_check", sql`${t.serviceType} in ('camera', 'electrical', 'plumbing')`),
  check("service_job_trade_records_version_check", sql`${t.schemaVersion} > 0 and ${t.version} > 0`),
  index("service_job_trade_records_store_type_idx").on(t.storeId, t.serviceType),
]);

export const serviceJobDependencies = pgTable("service_job_dependencies", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  predecessorJobId: uuid("predecessor_job_id").notNull().references(() => serviceJobs.id, { onDelete: "cascade" }),
  successorJobId: uuid("successor_job_id").notNull().references(() => serviceJobs.id, { onDelete: "cascade" }),
  dependencyType: text("dependency_type").notNull().default("finish_to_start"),
  status: text("status").notNull().default("pending"),
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("service_job_dependencies_pair_unique").on(t.predecessorJobId, t.successorJobId),
  check("service_job_dependencies_not_self_check", sql`${t.predecessorJobId} <> ${t.successorJobId}`),
  check("service_job_dependencies_type_check", sql`${t.dependencyType} in ('finish_to_start', 'evidence_required', 'handoff')`),
  check("service_job_dependencies_status_check", sql`${t.status} in ('pending', 'ready', 'blocked', 'completed', 'waived')`),
  index("service_job_dependencies_project_idx").on(t.projectId, t.status),
]);

export const serviceCoordinationPoints = pgTable("service_coordination_points", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  locationLabel: text("location_label"),
  serviceTypes: jsonb("service_types").$type<Array<"camera" | "electrical" | "plumbing">>().notNull().default([]),
  status: text("status").notNull().default("open"),
  description: text("description"),
  assignedTo: uuid("assigned_to").references(() => profiles.id, { onDelete: "set null" }),
  dueAt: timestamp("due_at", { withTimezone: true }),
  isAcceptanceRequired: boolean("is_acceptance_required").notNull().default(true),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("service_coordination_points_status_check", sql`${t.status} in ('open', 'ready', 'blocked', 'resolved', 'waived')`),
  check("service_coordination_points_types_check", sql`jsonb_typeof(${t.serviceTypes}) = 'array' and jsonb_array_length(${t.serviceTypes}) >= 2`),
  index("service_coordination_points_project_idx").on(t.projectId, t.status),
]);

export const serviceJobMaterials = pgTable("service_job_materials", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => serviceJobs.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  unitName: varchar("unit_name", { length: 30 }).notNull(),
  plannedQuantity: decimal("planned_quantity", { precision: 14, scale: 4 }).notNull().default("0"),
  usedQuantity: decimal("used_quantity", { precision: 14, scale: 4 }).notNull().default("0"),
  note: text("note"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("service_job_materials_version_check", sql`${t.version} > 0`),
  uniqueIndex("service_job_materials_job_product_unit_idx").on(t.jobId, t.productId, t.unitName),
  index("service_job_materials_product_idx").on(t.productId),
]);

export const serviceCostEntries = pgTable("service_cost_entries", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  unique("service_handover_documents_store_id_id_unique").on(t.storeId, t.id),
]);

export const serviceHandoverDocumentMedia = pgTable("service_handover_document_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull(),
  mediaObjectId: uuid("media_object_id").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("service_handover_document_media_unique").on(t.documentId, t.mediaObjectId),
  check("service_handover_document_media_sort_order_check", sql`${t.sortOrder} >= 0`),
  index("service_handover_document_media_store_document_order_idx").on(t.storeId, t.documentId, t.sortOrder),
  index("service_handover_document_media_store_media_object_idx").on(t.storeId, t.mediaObjectId),
  foreignKey({
    columns: [t.storeId, t.documentId],
    foreignColumns: [serviceHandoverDocuments.storeId, serviceHandoverDocuments.id],
    name: "service_handover_document_media_document_tenant_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [t.storeId, t.mediaObjectId],
    foreignColumns: [mediaObjects.storeId, mediaObjects.id],
    name: "service_handover_document_media_object_tenant_fk",
  }).onDelete("no action"),
]);

export const serviceMaintenancePlans = pgTable("service_maintenance_plans", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").references(() => installedAssets.id, { onDelete: "set null" }),
  serviceType: serviceTypeEnum("service_type").notNull(),
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
  check("service_maintenance_plans_service_type_check", sql`${t.serviceType} in ('camera', 'electrical', 'plumbing')`),
  index("service_maintenance_plans_due_idx").on(t.isActive, t.nextDueOn),
  index("service_maintenance_plans_project_idx").on(t.projectId, t.isActive),
]);

export const installedAssets = pgTable("installed_assets", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  clientRequestId: varchar("client_request_id", { length: 200 }),
  status: serviceAssetStatusEnum("status").notNull().default("installed"),
  note: text("note"),
  specs: jsonb("specs").$type<InstalledAssetSpecs>().notNull().default({}),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("installed_assets_store_id_id_unique").on(t.storeId, t.id),
  check("installed_assets_version_check", sql`${t.version} > 0`),
  index("installed_assets_project_idx").on(t.projectId, t.status),
  index("installed_assets_job_idx").on(t.jobId),
  index("installed_assets_product_idx")
    .on(t.productId)
    .where(sql`${t.productId} is not null`),
  uniqueIndex("installed_assets_store_serial_idx")
    .on(t.storeId, t.serialNumber)
    .where(sql`${t.serialNumber} is not null`),
  uniqueIndex("installed_assets_store_request_idx")
    .on(t.storeId, t.clientRequestId)
    .where(sql`${t.clientRequestId} is not null`),
]);

export const serviceCameraVaults = pgTable("service_camera_vaults", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").notNull().references(() => installedAssets.id, { onDelete: "cascade" }),
  ciphertext: text("ciphertext").notNull(),
  iv: varchar("iv", { length: 24 }).notNull(),
  authTag: varchar("auth_tag", { length: 32 }).notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  configured: boolean("configured").notNull().default(false),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  rotatedBy: uuid("rotated_by").references(() => profiles.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("service_camera_vaults_asset_unique").on(t.assetId),
  check("service_camera_vaults_key_version_check", sql`${t.keyVersion} > 0`),
  index("service_camera_vaults_project_idx").on(t.projectId),
]);

export const serviceCameraVaultViewers = pgTable("service_camera_vault_viewers", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  vaultId: uuid("vault_id").notNull().references(() => serviceCameraVaults.id, { onDelete: "cascade" }),
  profileId: uuid("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  canReveal: boolean("can_reveal").notNull().default(true),
  canCopy: boolean("can_copy").notNull().default(false),
  canRotate: boolean("can_rotate").notNull().default(false),
  canManageViewers: boolean("can_manage_viewers").notNull().default(false),
  grantedBy: uuid("granted_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("service_camera_vault_viewers_profile_unique").on(t.vaultId, t.profileId),
  index("service_camera_vault_viewers_profile_idx").on(t.profileId, t.vaultId),
]);

export const warrantyClaims = pgTable("warranty_claims", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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

export const warrantyClaimNotifications = pgTable("warranty_claim_notifications", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id").notNull().references(() => warrantyClaims.id, { onDelete: "cascade" }),
  recipientId: uuid("recipient_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  notificationType: text("notification_type").notNull().default("created"),
  readAt: timestamp("read_at", { withTimezone: true }),
  pushAttemptedAt: timestamp("push_attempted_at", { withTimezone: true }),
  pushDispatchedAt: timestamp("push_dispatched_at", { withTimezone: true }),
  pushClaimToken: uuid("push_claim_token"),
  pushClaimedAt: timestamp("push_claimed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("warranty_claim_notifications_type_check", sql`${t.notificationType} in ('created', 'status_changed')`),
  uniqueIndex("warranty_claim_notifications_claim_recipient_type_idx").on(
    t.claimId,
    t.recipientId,
    t.notificationType,
  ),
  index("warranty_claim_notifications_recipient_idx").on(t.recipientId, t.readAt, t.createdAt),
  check("warranty_claim_notifications_push_claim_check", sql`(${t.pushClaimToken} is null) = (${t.pushClaimedAt} is null)`),
  index("warranty_claim_notifications_push_idx").on(t.pushDispatchedAt, t.pushClaimedAt, t.createdAt),
]);

export const serviceStatusLogs = pgTable("service_status_logs", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => serviceJobs.id, { onDelete: "cascade" }),
  fromStatus: serviceJobStatusEnum("from_status"),
  toStatus: serviceJobStatusEnum("to_status").notNull(),
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("service_status_logs_job_idx").on(t.jobId, t.createdAt)]);

export const serviceJobAssignments = pgTable("service_job_assignments", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => serviceJobs.id, { onDelete: "cascade" }),
  profileId: uuid("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  assignmentRole: text("assignment_role").notNull().default("crew"),
  assignedBy: uuid("assigned_by").references(() => profiles.id, { onDelete: "set null" }),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  removedAt: timestamp("removed_at", { withTimezone: true }),
}, (t) => [
  check("service_job_assignments_role_check", sql`${t.assignmentRole} in ('primary', 'crew')`),
  uniqueIndex("service_job_assignments_job_profile_idx").on(t.jobId, t.profileId),
  index("service_job_assignments_profile_active_idx").on(t.profileId, t.removedAt),
]);

export const serviceVisits = pgTable("service_visits", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => serviceJobs.id, { onDelete: "cascade" }),
  profileId: uuid("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }).defaultNow().notNull(),
  checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
  checkInLatitude: decimal("check_in_latitude", { precision: 9, scale: 6 }),
  checkInLongitude: decimal("check_in_longitude", { precision: 9, scale: 6 }),
  checkOutLatitude: decimal("check_out_latitude", { precision: 9, scale: 6 }),
  checkOutLongitude: decimal("check_out_longitude", { precision: 9, scale: 6 }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("service_visits_status_check", sql`${t.status} in ('active', 'completed', 'cancelled')`),
  check("service_visits_check_out_check", sql`${t.checkedOutAt} is null or ${t.checkedOutAt} >= ${t.checkedInAt}`),
  index("service_visits_job_time_idx").on(t.jobId, t.checkedInAt),
  uniqueIndex("service_visits_job_profile_active_idx").on(t.jobId, t.profileId).where(sql`${t.status} = 'active'`),
]);

export const serviceTimeEntries = pgTable("service_time_entries", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => serviceJobs.id, { onDelete: "cascade" }),
  visitId: uuid("visit_id").references(() => serviceVisits.id, { onDelete: "set null" }),
  profileId: uuid("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  entryType: text("entry_type").notNull().default("work"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("service_time_entries_type_check", sql`${t.entryType} in ('work', 'travel')`),
  check("service_time_entries_end_check", sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
  index("service_time_entries_job_profile_idx").on(t.jobId, t.profileId, t.startedAt),
  uniqueIndex("service_time_entries_visit_open_idx").on(t.visitId).where(sql`${t.visitId} is not null and ${t.endedAt} is null`),
]);

export const serviceAttachments = pgTable("service_attachments", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => serviceJobs.id, { onDelete: "cascade" }),
  claimId: uuid("claim_id").references(() => warrantyClaims.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").references(() => installedAssets.id, { onDelete: "restrict" }),
  requestId: uuid("request_id").references((): AnyPgColumn => serviceCustomerRequests.id, { onDelete: "cascade" }),
  mediaObjectId: uuid("media_object_id"),
  projectPhase: text("project_phase").$type<"survey" | "construction" | "after_installation" | "acceptance" | "handover" | "other">(),
  category: text("category").notNull(),
  bucket: varchar("bucket", { length: 80 }).notNull(),
  path: text("path").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: varchar("mime_type", { length: 120 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: varchar("sha256", { length: 64 }),
  caption: text("caption"),
  clientRequestId: varchar("client_request_id", { length: 200 }),
  sortOrder: integer("sort_order").notNull().default(0),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: uuid("deleted_by").references(() => profiles.id, { onDelete: "set null" }),
  storageDeletedAt: timestamp("storage_deleted_at", { withTimezone: true }),
  storageDeleteAttempts: integer("storage_delete_attempts").notNull().default(0),
  storageDeleteLastError: text("storage_delete_last_error"),
  cleanupClaimedAt: timestamp("cleanup_claimed_at", { withTimezone: true }),
  cleanupClaimToken: uuid("cleanup_claim_token"),
}, (t) => [
  unique("service_attachments_store_id_id_unique").on(t.storeId, t.id),
  check("service_attachments_category_check", sql`${t.category} in ('before', 'after', 'issue', 'document', 'signature', 'asset')`),
  check("service_attachments_size_check", sql`${t.sizeBytes} > 0`),
  check("service_attachments_sort_order_check", sql`${t.sortOrder} >= 0`),
  check("service_attachments_primary_asset_check", sql`not ${t.isPrimary} or (${t.assetId} is not null and ${t.category} = 'asset')`),
  check("service_attachments_project_phase_check", sql`${t.projectPhase} is null or ${t.projectPhase} in ('survey', 'construction', 'after_installation', 'acceptance', 'handover', 'other')`),
  uniqueIndex("service_attachments_bucket_path_idx").on(t.bucket, t.path),
  index("service_attachments_job_idx").on(t.jobId, t.createdAt),
  index("service_attachments_claim_idx").on(t.claimId, t.createdAt),
  index("service_attachments_asset_idx").on(t.assetId, t.sortOrder, t.createdAt),
  uniqueIndex("service_attachments_asset_request_idx")
    .on(t.storeId, t.assetId, t.clientRequestId)
    .where(sql`${t.assetId} is not null and ${t.clientRequestId} is not null`),
  uniqueIndex("service_attachments_asset_primary_idx")
    .on(t.assetId)
    .where(sql`${t.assetId} is not null and ${t.isPrimary} and ${t.deletedAt} is null`),
  index("service_attachments_active_job_idx").on(t.jobId, t.createdAt).where(sql`${t.deletedAt} is null`),
  index("service_attachments_cleanup_retry_idx").on(t.cleanupClaimedAt, t.createdAt).where(sql`${t.deletedAt} is not null and ${t.storageDeletedAt} is null`),
  index("service_attachments_media_object_idx").on(t.mediaObjectId).where(sql`${t.mediaObjectId} is not null`),
  foreignKey({
    columns: [t.storeId, t.mediaObjectId],
    foreignColumns: [mediaObjects.storeId, mediaObjects.id],
    name: "service_attachments_media_object_tenant_fk",
  }).onDelete("no action"),
]);

export const serviceSignatures = pgTable("service_signatures", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull().references(() => serviceJobs.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").references(() => serviceHandoverDocuments.id, { onDelete: "set null" }),
  attachmentId: uuid("attachment_id").notNull().references(() => serviceAttachments.id, { onDelete: "restrict" }),
  signerName: text("signer_name").notNull(),
  signerRole: text("signer_role"),
  documentHash: varchar("document_hash", { length: 64 }).notNull(),
  canonicalSnapshot: jsonb("canonical_snapshot").$type<Record<string, unknown>>(),
  snapshotSchemaVersion: integer("snapshot_schema_version"),
  signedByProfileId: uuid("signed_by_profile_id").references(() => profiles.id, { onDelete: "set null" }),
  signedAt: timestamp("signed_at", { withTimezone: true }).defaultNow().notNull(),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  invalidatedBy: uuid("invalidated_by").references(() => profiles.id, { onDelete: "set null" }),
  invalidationReason: text("invalidation_reason"),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [
  check("service_signatures_hash_check", sql`${t.documentHash} ~ '^[0-9a-f]{64}$'`),
  check("service_signatures_snapshot_version_check", sql`${t.snapshotSchemaVersion} is null or ${t.snapshotSchemaVersion} > 0`),
  check("service_signatures_invalidation_check", sql`${t.invalidatedAt} is not null or (${t.invalidatedBy} is null and ${t.invalidationReason} is null)`),
  index("service_signatures_job_idx").on(t.jobId, t.signedAt),
  index("service_signatures_active_job_idx").on(t.jobId, t.signedAt).where(sql`${t.invalidatedAt} is null`),
  foreignKey({
    columns: [t.storeId, t.attachmentId],
    foreignColumns: [serviceAttachments.storeId, serviceAttachments.id],
    name: "service_signatures_attachment_tenant_fk",
  }).onDelete("restrict"),
]);

export const serviceJobEvents = pgTable("service_job_events", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => serviceJobs.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  actorId: uuid("actor_id").references(() => profiles.id, { onDelete: "set null" }),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("service_job_events_job_idx").on(t.jobId, t.createdAt)]);

export const serviceFieldMutations = pgTable("service_field_mutations", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  clientMutationId: varchar("client_mutation_id", { length: 100 }).notNull(),
  actorId: uuid("actor_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull().references(() => serviceJobs.id, { onDelete: "cascade" }),
  operation: text("operation").notNull(),
  inputHash: varchar("input_hash", { length: 64 }),
  result: jsonb("result").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("service_field_mutations_input_hash_check", sql`${t.inputHash} is null or ${t.inputHash} ~ '^[0-9a-f]{64}$'`),
  uniqueIndex("service_field_mutations_client_idx").on(t.actorId, t.clientMutationId),
]);

export const serviceMaintenanceOccurrences = pgTable("service_maintenance_occurrences", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id").notNull().references(() => serviceMaintenancePlans.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => serviceJobs.id, { onDelete: "set null" }),
  dueOn: date("due_on").notNull(),
  status: text("status").notNull().default("scheduled"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  check("service_maintenance_occurrences_status_check", sql`${t.status} in ('scheduled', 'completed', 'skipped', 'overdue')`),
  uniqueIndex("service_maintenance_occurrences_plan_due_idx").on(t.planId, t.dueOn),
  uniqueIndex("service_maintenance_occurrences_plan_outstanding_idx").on(t.planId)
    .where(sql`${t.status} in ('scheduled', 'overdue')`),
  uniqueIndex("service_maintenance_occurrences_job_idx").on(t.jobId).where(sql`${t.jobId} is not null`),
  index("service_maintenance_occurrences_due_idx").on(t.status, t.dueOn),
]);

export const serviceSlaPolicies = pgTable("service_sla_policies", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  priority: serviceJobPriorityEnum("priority").notNull(),
  responseMinutes: integer("response_minutes").notNull(),
  resolutionMinutes: integer("resolution_minutes").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("service_sla_policies_minutes_check", sql`${t.responseMinutes} > 0 and ${t.resolutionMinutes} >= ${t.responseMinutes}`),
  uniqueIndex("service_sla_policies_priority_active_idx").on(t.priority).where(sql`${t.isActive}`),
]);

export const serviceCustomerRequests = pgTable("service_customer_requests", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  assetId: uuid("asset_id").references(() => installedAssets.id, { onDelete: "set null" }),
  claimId: uuid("claim_id").references(() => warrantyClaims.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  contactName: text("contact_name").notNull(),
  contactPhone: varchar("contact_phone", { length: 20 }),
  priority: serviceJobPriorityEnum("priority").notNull().default("normal"),
  status: text("status").notNull().default("new"),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }).notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  linkedJobId: uuid("linked_job_id").references(() => serviceJobs.id, { onDelete: "set null" }),
  triagedBy: uuid("triaged_by").references(() => profiles.id, { onDelete: "set null" }),
  internalNote: text("internal_note"),
  responseDueAt: timestamp("response_due_at", { withTimezone: true }),
  resolutionDueAt: timestamp("resolution_due_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("service_customer_requests_status_check", sql`${t.status} in ('new', 'triaged', 'scheduled', 'in_progress', 'resolved', 'closed', 'void')`),
  uniqueIndex("service_customer_requests_token_idx").on(t.tokenHash),
  index("service_customer_requests_sla_idx").on(t.status, t.responseDueAt, t.resolutionDueAt),
]);

export const serviceCustomerRequestAttachments = pgTable("service_customer_request_attachments", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => serviceCustomerRequests.id, { onDelete: "cascade" }),
  mediaObjectId: uuid("media_object_id"),
  bucket: text("bucket").notNull(),
  path: text("path").notNull().unique(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  width: integer("width"),
  height: integer("height"),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("service_customer_request_attachments_mime_check", sql`${t.mimeType} in ('image/jpeg', 'image/png', 'image/webp')`),
  check("service_customer_request_attachments_size_check", sql`${t.sizeBytes} > 0 and ${t.sizeBytes} <= 8388608`),
  check("service_customer_request_attachments_dimensions_check", sql`(${t.width} is null and ${t.height} is null) or (${t.width} > 0 and ${t.height} > 0 and ${t.width} <= 6000 and ${t.height} <= 6000 and (${t.width}::bigint * ${t.height}::bigint) <= 20000000)`),
  check("service_customer_request_attachments_sha_check", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  index("service_customer_request_attachments_request_idx").on(t.requestId, t.createdAt),
  index("service_customer_request_attachments_media_object_idx").on(t.mediaObjectId).where(sql`${t.mediaObjectId} is not null`),
  foreignKey({
    columns: [t.storeId, t.mediaObjectId],
    foreignColumns: [mediaObjects.storeId, mediaObjects.id],
    name: "service_customer_request_attachments_media_object_tenant_fk",
  }).onDelete("no action"),
]);

export const serviceCustomerRequestStorageCleanup = pgTable("service_customer_request_storage_cleanup", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").references(() => serviceCustomerRequests.id, { onDelete: "set null" }),
  bucket: text("bucket").notNull(),
  path: text("path").notNull().unique(),
  notBefore: timestamp("not_before", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  claimToken: uuid("claim_token"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("service_customer_request_cleanup_claim_check", sql`(${t.claimToken} is null) = (${t.claimedAt} is null)`),
  check("service_customer_request_cleanup_attempts_check", sql`${t.attempts} >= 0`),
  index("service_customer_request_cleanup_retry_idx").on(t.notBefore, t.claimedAt, t.createdAt),
]);

export const serviceCustomerRequestNotifications = pgTable("service_customer_request_notifications", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => serviceCustomerRequests.id, { onDelete: "cascade" }),
  recipientId: uuid("recipient_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  notificationType: text("notification_type").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("service_customer_request_notifications_unique_idx").on(t.requestId, t.recipientId, t.notificationType),
  index("service_customer_request_notifications_recipient_idx").on(t.recipientId, t.readAt, t.createdAt),
]);

export const servicePublicRateLimits = pgTable("service_public_rate_limits", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  bucketKey: varchar("bucket_key", { length: 160 }).notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  requestCount: integer("request_count").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.bucketKey, t.windowStart] }),
  check("service_public_rate_limits_count_check", sql`${t.requestCount} > 0`),
  index("service_public_rate_limits_expiry_idx").on(t.expiresAt),
]);

export const cameraVendorConnections = pgTable("camera_vendor_connections", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  vendor: text("vendor").notNull(),
  name: text("name").notNull(),
  region: varchar("region", { length: 40 }),
  status: text("status").notNull().default("disabled"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("camera_vendor_connections_vendor_check", sql`${t.vendor} in ('ezviz', 'hikvision', 'dahua', 'uniview')`),
  check("camera_vendor_connections_status_check", sql`${t.status} in ('disabled', 'active', 'error')`),
]);

export const cameraDeviceLinks = pgTable("camera_device_links", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  connectionId: uuid("connection_id").notNull().references(() => cameraVendorConnections.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").notNull().references(() => installedAssets.id, { onDelete: "cascade" }),
  externalDeviceId: text("external_device_id").notNull(),
  vendorAppUrl: text("vendor_app_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("camera_device_links_connection_external_idx").on(t.connectionId, t.externalDeviceId),
  uniqueIndex("camera_device_links_asset_connection_idx").on(t.assetId, t.connectionId),
]);

export const cameraHealthSnapshots = pgTable("camera_health_snapshots", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  deviceLinkId: uuid("device_link_id").notNull().references(() => cameraDeviceLinks.id, { onDelete: "cascade" }),
  online: boolean("online"),
  status: text("status").notNull().default("unknown"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  firmwareVersion: text("firmware_version"),
  storageStatus: text("storage_status"),
  channelCount: integer("channel_count"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
  rawHash: varchar("raw_hash", { length: 64 }),
}, (t) => [
  check("camera_health_snapshots_status_check", sql`${t.status} in ('healthy', 'warning', 'offline', 'unknown')`),
  index("camera_health_snapshots_device_idx").on(t.deviceLinkId, t.capturedAt),
]);

export const cameraDeviceAlerts = pgTable("camera_device_alerts", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  deviceLinkId: uuid("device_link_id").notNull().references(() => cameraDeviceLinks.id, { onDelete: "cascade" }),
  externalAlertId: text("external_alert_id").notNull(),
  alertType: text("alert_type").notNull(),
  severity: text("severity").notNull().default("warning"),
  message: text("message"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("camera_device_alerts_severity_check", sql`${t.severity} in ('info', 'warning', 'critical')`),
  uniqueIndex("camera_device_alerts_device_external_idx").on(t.deviceLinkId, t.externalAlertId),
  index("camera_device_alerts_open_idx").on(t.deviceLinkId, t.resolvedAt, t.occurredAt),
]);

export const cameraSyncRuns = pgTable("camera_sync_runs", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  connectionId: uuid("connection_id").notNull().references(() => cameraVendorConnections.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"),
  deviceCount: integer("device_count").notNull().default(0),
  alertCount: integer("alert_count").notNull().default(0),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [
  check("camera_sync_runs_status_check", sql`${t.status} in ('running', 'succeeded', 'partial', 'failed')`),
  index("camera_sync_runs_connection_idx").on(t.connectionId, t.startedAt),
]);

// ============= Khuyến mãi (bậc thang theo SL) =============

export const promotions = pgTable("promotions", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull(), // CX-
  vehicle: text("vehicle"),
  driver: text("driver"),
  status: tripStatusEnum("status").notNull().default("planned"),
  departAt: timestamp("depart_at", { withTimezone: true }),
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("trips_store_code_unique").on(t.storeId, t.code)]);

export const tripStops = pgTable("trip_stops", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  code: varchar("code", { length: 30 }).notNull(), // KK-
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id),
  status: stocktakeStatusEnum("status").notNull().default("draft"),
  note: text("note"),
  balancedAt: timestamp("balanced_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("stocktakes_store_code_unique").on(t.storeId, t.code)]);

export const stocktakeItems = pgTable("stocktake_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  uniqueIndex("print_templates_store_default_doc_type_idx").on(t.storeId, t.docType).where(sql`${t.isDefault} = true and ${t.isActive} = true`),
]);

// ============= Barcode label templates (mẫu in tem mã sản phẩm) =============

export const labelTemplates = pgTable("label_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  uniqueIndex("label_templates_store_default_idx").on(t.storeId).where(sql`${t.isDefault} = true and ${t.isActive} = true`),
]);

// ============= Shifts (Quản lý ca — Part 17) =============

export const shifts = pgTable("shifts", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  code: varchar("code", { length: 30 }).notNull(),
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
  uniqueIndex("shifts_store_code_unique").on(t.storeId, t.code),
  index("shifts_status_idx").on(t.status),
  index("shifts_user_idx").on(t.userId),
  index("shifts_handover_to_user_idx").on(t.handoverToUserId),
  index("shifts_handover_from_shift_idx").on(t.handoverFromShiftId),
  uniqueIndex("shifts_store_open_user_unique_idx").on(t.storeId, t.userId).where(sql`${t.status} = 'open'`),
]);

// ============= F&B dining tables (Part 18) =============

export const diningTables = pgTable("dining_tables", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  id: uuid("id").primaryKey().defaultRandom(),
  tableId: uuid("table_id").references(() => diningTables.id, { onDelete: "set null" }),
  tableName: text("table_name").notNull().default(""),
  round: integer("round").notNull().default(1),
  status: text("status").notNull().default("active"), // active | done
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("kitchen_tickets_status_idx").on(t.status, t.createdAt)]);

export const kitchenTicketItems = pgTable("kitchen_ticket_items", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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

// ============= Store settings =============

export const storeSettings = pgTable("store_settings", {
  id: text("id").notNull().default("default"),
  storeId: uuid("store_id").primaryKey().references(() => stores.id, { onDelete: "cascade" }),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  period: varchar("period", { length: 7 }).notNull(), // YYYY-MM
  usedUnits: integer("used_units").notNull().default(0),
  limitUnits: integer("limit_units").notNull().default(1000),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedCostMicrousd: integer("estimated_cost_microusd").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.storeId, t.period] })]);

export const aiUsageEvents = pgTable("ai_usage_events", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  uniqueIndex("marketplace_shops_store_provider_shop_idx").on(t.storeId, t.provider, t.shopId),
  index("marketplace_shops_store_provider_status_idx").on(t.storeId, t.provider, t.status),
]);

export const marketplaceTokens = pgTable("marketplace_tokens", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  uniqueIndex("marketplace_product_mappings_store_product_idx").on(t.storeId, t.provider, t.productId),
  uniqueIndex("marketplace_product_mappings_store_external_idx").on(t.storeId, t.provider, t.externalItemId),
  index("marketplace_product_mappings_store_status_idx").on(t.storeId, t.provider, t.status),
]);

export const marketplaceOrderMappings = pgTable("marketplace_order_mappings", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  uniqueIndex("marketplace_order_mappings_store_order_idx").on(t.storeId, t.provider, t.externalOrderSn),
  index("marketplace_order_mappings_store_luma_order_idx").on(t.storeId, t.orderId),
]);

export const marketplaceMessageThreads = pgTable("marketplace_message_threads", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  uniqueIndex("marketplace_message_threads_store_thread_idx").on(t.storeId, t.provider, t.externalThreadId),
  index("marketplace_message_threads_store_last_idx").on(t.storeId, t.provider, t.lastMessageAt),
]);

export const marketplaceMessages = pgTable("marketplace_messages", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  uniqueIndex("marketplace_sync_jobs_store_idempotency_idx").on(t.storeId, t.provider, t.idempotencyKey),
  index("marketplace_sync_jobs_store_status_idx").on(t.storeId, t.provider, t.status, t.nextRunAt),
]);

export const aiListingSuggestions = pgTable("ai_listing_suggestions", {
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
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
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  code: varchar("code", { length: 30 }).notNull(), // XNB-...
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
}, (t) => [uniqueIndex("internal_use_issues_store_code_unique").on(t.storeId, t.code)]);

export const internalUseItems = pgTable("internal_use_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id),
  issueId: uuid("issue_id").notNull().references(() => internalUseIssues.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  productName: text("product_name").notNull(),
  unitName: varchar("unit_name", { length: 30 }).notNull(),
  unitMultiplier: decimal("unit_multiplier", { precision: 14, scale: 4 }).notNull(),
  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull(),
  unitCost: decimal("unit_cost", { precision: 14, scale: 2 }).notNull(),
  total: decimal("total", { precision: 14, scale: 2 }).notNull(),
}, (t) => [index("internal_use_items_issue_idx").on(t.issueId)]);

// ============= Media migration tracking =============

export const mediaMigrationRuns = pgTable("media_migration_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id, { onDelete: "cascade" }),
  status: text("status").$type<"pending" | "running" | "completed" | "failed" | "rolled_back">().notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("media_migration_runs_status_check", sql`${t.status} in ('pending', 'running', 'completed', 'failed', 'rolled_back')`),
  unique("media_migration_runs_store_id_id_unique").on(t.storeId, t.id),
  index("media_migration_runs_store_status_idx").on(t.storeId, t.status, t.createdAt),
  index("media_migration_runs_store_created_by_idx")
    .on(t.storeId, t.createdBy)
    .where(sql`${t.createdBy} is not null`),
  foreignKey({
    columns: [t.storeId, t.createdBy],
    foreignColumns: [profiles.storeId, profiles.id],
    name: "media_migration_runs_created_by_tenant_fk",
  }).onDelete("no action"),
]);

export const mediaMigrationItems = pgTable("media_migration_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().$defaultFn(missingStoreId).references(() => stores.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull(),
  sourceProvider: text("source_provider").$type<MediaProvider | "external">().notNull(),
  sourceBucket: text("source_bucket").notNull(),
  sourceKey: text("source_key").notNull(),
  targetBucket: text("target_bucket"),
  targetKey: text("target_key"),
  mediaObjectId: uuid("media_object_id"),
  status: text("status").$type<"inventoried" | "copied" | "verified" | "cutover" | "source_deleted" | "quarantined" | "skipped" | "failed" | "rolled_back">().notNull().default("inventoried"),
  purpose: text("purpose").$type<"product-image" | "project-document" | "service-evidence" | "ai-attachment">().notNull().default("project-document"),
  targetId: uuid("target_id"),
  domain: text("domain").notNull().default("legacy"),
  visibility: text("visibility").$type<MediaVisibility>().notNull().default("private"),
  originalFileName: text("original_file_name").notNull().default("legacy-media"),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  referenceDocuments: jsonb("reference_documents").$type<Record<string, unknown>[]>().notNull().default([]),
  sourceSizeBytes: bigint("source_size_bytes", { mode: "number" }),
  sourceSha256: varchar("source_sha256", { length: 64 }),
  targetSizeBytes: bigint("target_size_bytes", { mode: "number" }),
  targetSha256: varchar("target_sha256", { length: 64 }),
  attempts: integer("attempts").notNull().default(0),
  fallbackReadCount: integer("fallback_read_count").notNull().default(0),
  lastError: text("last_error"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  cutoverAt: timestamp("cutover_at", { withTimezone: true }),
  sourceDeletedAt: timestamp("source_deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("media_migration_items_source_provider_check", sql`${t.sourceProvider} in ('r2', 'supabase', 'external')`),
  check("media_migration_items_status_check", sql`${t.status} in ('inventoried', 'copied', 'verified', 'cutover', 'source_deleted', 'quarantined', 'skipped', 'failed', 'rolled_back')`),
  check("media_migration_items_purpose_check", sql`${t.purpose} in ('product-image', 'project-document', 'service-evidence', 'ai-attachment')`),
  check("media_migration_items_visibility_check", sql`${t.visibility} in ('public', 'private')`),
  check("media_migration_items_reference_documents_check", sql`jsonb_typeof(${t.referenceDocuments}) = 'array'`),
  check("media_migration_items_source_size_check", sql`${t.sourceSizeBytes} is null or ${t.sourceSizeBytes} > 0`),
  check("media_migration_items_target_size_check", sql`${t.targetSizeBytes} is null or ${t.targetSizeBytes} > 0`),
  check("media_migration_items_source_sha_check", sql`${t.sourceSha256} is null or ${t.sourceSha256} ~ '^[0-9a-f]{64}$'`),
  check("media_migration_items_target_sha_check", sql`${t.targetSha256} is null or ${t.targetSha256} ~ '^[0-9a-f]{64}$'`),
  check("media_migration_items_attempts_check", sql`${t.attempts} >= 0`),
  check("media_migration_items_fallback_reads_check", sql`${t.fallbackReadCount} >= 0`),
  unique("media_migration_items_source_unique").on(t.runId, t.sourceProvider, t.sourceBucket, t.sourceKey),
  uniqueIndex("media_migration_items_run_target_unique")
    .on(t.runId, t.targetBucket, t.targetKey)
    .where(sql`${t.targetBucket} is not null and ${t.targetKey} is not null`),
  index("media_migration_items_store_status_idx").on(t.storeId, t.status, t.updatedAt),
  index("media_migration_items_run_status_idx").on(t.runId, t.status, t.updatedAt),
  index("media_migration_items_store_purpose_target_idx").on(t.storeId, t.purpose, t.targetId),
  index("media_migration_items_store_media_object_idx")
    .on(t.storeId, t.mediaObjectId)
    .where(sql`${t.mediaObjectId} is not null`),
  foreignKey({
    columns: [t.storeId, t.runId],
    foreignColumns: [mediaMigrationRuns.storeId, mediaMigrationRuns.id],
    name: "media_migration_items_run_tenant_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [t.storeId, t.mediaObjectId],
    foreignColumns: [mediaObjects.storeId, mediaObjects.id],
    name: "media_migration_items_object_tenant_fk",
  }).onDelete("no action"),
]);

// ============= Relations =============

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  units: many(productUnits),
  stockLevels: many(stockLevels),
  comboItems: many(productComboItems, { relationName: "comboProduct" }),
  includedInCombos: many(productComboItems, { relationName: "comboComponent" }),
  media: many(productMedia),
}));

export const mediaObjectsRelations = relations(mediaObjects, ({ one, many }) => ({
  store: one(stores, { fields: [mediaObjects.storeId], references: [stores.id] }),
  creator: one(profiles, { fields: [mediaObjects.createdBy], references: [profiles.id] }),
  products: many(productMedia),
  handoverDocuments: many(serviceHandoverDocumentMedia),
  migrationItems: many(mediaMigrationItems),
  libraryItems: many(mediaLibraryItems),
}));

export const mediaLibraryItemsRelations = relations(mediaLibraryItems, ({ one }) => ({
  mediaObject: one(mediaObjects, {
    fields: [mediaLibraryItems.mediaObjectId],
    references: [mediaObjects.id],
  }),
  creator: one(profiles, {
    fields: [mediaLibraryItems.createdBy],
    references: [profiles.id],
  }),
}));

export const productMediaRelations = relations(productMedia, ({ one }) => ({
  product: one(products, { fields: [productMedia.productId], references: [products.id] }),
  mediaObject: one(mediaObjects, { fields: [productMedia.mediaObjectId], references: [mediaObjects.id] }),
}));

export const serviceHandoverDocumentMediaRelations = relations(serviceHandoverDocumentMedia, ({ one }) => ({
  document: one(serviceHandoverDocuments, {
    fields: [serviceHandoverDocumentMedia.documentId],
    references: [serviceHandoverDocuments.id],
  }),
  mediaObject: one(mediaObjects, {
    fields: [serviceHandoverDocumentMedia.mediaObjectId],
    references: [mediaObjects.id],
  }),
}));

export const mediaMigrationRunsRelations = relations(mediaMigrationRuns, ({ many }) => ({
  items: many(mediaMigrationItems),
}));

export const mediaMigrationItemsRelations = relations(mediaMigrationItems, ({ one }) => ({
  run: one(mediaMigrationRuns, { fields: [mediaMigrationItems.runId], references: [mediaMigrationRuns.id] }),
  mediaObject: one(mediaObjects, { fields: [mediaMigrationItems.mediaObjectId], references: [mediaObjects.id] }),
}));

export const productComboItemsRelations = relations(productComboItems, ({ one }) => ({
  combo: one(products, {
    fields: [productComboItems.comboProductId],
    references: [products.id],
    relationName: "comboProduct",
  }),
  component: one(products, {
    fields: [productComboItems.componentProductId],
    references: [products.id],
    relationName: "comboComponent",
  }),
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
