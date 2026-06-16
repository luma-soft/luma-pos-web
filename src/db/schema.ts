import {
  pgTable, uuid, text, varchar, integer, decimal, timestamp,
  boolean, jsonb, primaryKey, index, uniqueIndex, pgEnum,
} from "drizzle-orm/pg-core";
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

// ============= Users (linked to Supabase auth.users) =============

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  fullName: text("full_name").notNull(),
  phone: varchar("phone", { length: 20 }),
  role: userRoleEnum("role").notNull().default("cashier"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

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

// ============= Orders (POS + Quotes + Construction) =============

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull().unique(), // HD20260506-001
  // Khử trùng đơn khi đồng bộ offline: mỗi đơn từ POS có 1 clientId; sync lại
  // không tạo đơn trùng (unique). Xem supabase/order-client-id.sql.
  clientId: varchar("client_id", { length: 40 }).unique(),
  status: orderStatusEnum("status").notNull().default("draft"),
  paymentStatus: paymentStatusEnum("payment_status").notNull().default("unpaid"),

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

  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("orders_status_idx").on(t.status),
  index("orders_customer_idx").on(t.customerId),
  index("orders_created_idx").on(t.createdAt),
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
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  method: paymentMethodEnum("method").notNull(),
  reference: text("reference"), // mã GD ngân hàng
  note: text("note"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("payments_order_idx").on(t.orderId)]);

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
}, (t) => [index("cash_tx_created_idx").on(t.createdAt)]);

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
