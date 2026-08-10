CREATE TABLE IF NOT EXISTS "internal_use_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(30) NOT NULL UNIQUE,
  "warehouse_id" uuid REFERENCES "warehouses"("id"),
  "department" text,
  "reason" text,
  "status" text DEFAULT 'approved' NOT NULL,
  "total_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
  "note" text,
  "created_by" uuid REFERENCES "profiles"("id"),
  "approved_by" uuid REFERENCES "profiles"("id"),
  "approved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internal_use_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "issue_id" uuid NOT NULL REFERENCES "internal_use_issues"("id") ON DELETE cascade,
  "product_id" uuid NOT NULL REFERENCES "products"("id"),
  "product_name" text NOT NULL,
  "unit_name" varchar(30) NOT NULL,
  "unit_multiplier" numeric(14, 4) NOT NULL,
  "quantity" numeric(14, 4) NOT NULL,
  "unit_cost" numeric(14, 2) NOT NULL,
  "total" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "internal_use_items_issue_idx"
  ON "internal_use_items" ("issue_id");
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'categories', 'brands', 'price_books', 'product_prices', 'warehouses',
    'products', 'product_combo_items', 'product_suppliers', 'stock_levels',
    'stock_movements', 'customers', 'suppliers', 'payment_bank_accounts',
    'orders', 'order_items', 'payments', 'customer_receivable_receipts',
    'customer_receivable_allocations', 'customer_receivable_entries',
    'purchase_orders', 'purchase_order_items', 'supplier_payable_receipts',
    'supplier_payable_allocations', 'supplier_payable_entries', 'stock_lots',
    'purchase_returns', 'purchase_return_items', 'returns', 'return_items',
    'payment_refunds', 'cash_transactions', 'stocktakes', 'stocktake_items',
    'print_templates', 'label_templates', 'shifts', 'internal_use_issues',
    'internal_use_items'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN store_id uuid NOT NULL DEFAULT %L REFERENCES public.stores(id)',
      table_name,
      '00000000-0000-4000-8000-000000000001'
    );
    EXECUTE format(
      'CREATE INDEX %I ON public.%I (store_id)',
      table_name || '_store_idx',
      table_name
    );
  END LOOP;
END
$$;
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'categories', 'brands', 'price_books', 'product_prices', 'warehouses',
    'products', 'product_combo_items', 'product_suppliers', 'stock_movements',
    'customers', 'suppliers', 'payment_bank_accounts', 'orders', 'order_items',
    'payments', 'customer_receivable_receipts', 'customer_receivable_allocations',
    'customer_receivable_entries', 'purchase_orders', 'purchase_order_items',
    'supplier_payable_receipts', 'supplier_payable_allocations',
    'supplier_payable_entries', 'stock_lots', 'purchase_returns',
    'purchase_return_items', 'returns', 'return_items', 'payment_refunds',
    'cash_transactions', 'stocktakes', 'stocktake_items', 'print_templates',
    'label_templates', 'shifts', 'internal_use_issues', 'internal_use_items'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (store_id, id)',
      table_name,
      table_name || '_store_id_id_unique'
    );
  END LOOP;
END
$$;
--> statement-breakpoint
ALTER TABLE "brands" DROP CONSTRAINT IF EXISTS "brands_name_unique";
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_sku_unique";
ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "customers_code_unique";
ALTER TABLE "suppliers" DROP CONSTRAINT IF EXISTS "suppliers_code_unique";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_code_unique";
DROP INDEX IF EXISTS "orders_client_id_key";
ALTER TABLE "customer_receivable_receipts" DROP CONSTRAINT IF EXISTS "customer_receivable_receipts_code_unique";
ALTER TABLE "customer_receivable_receipts" DROP CONSTRAINT IF EXISTS "customer_receivable_receipts_client_request_id_unique";
ALTER TABLE "customer_receivable_entries" DROP CONSTRAINT IF EXISTS "customer_receivable_entries_code_unique";
ALTER TABLE "customer_receivable_entries" DROP CONSTRAINT IF EXISTS "customer_receivable_entries_client_request_id_unique";
ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_code_unique";
ALTER TABLE "supplier_payable_receipts" DROP CONSTRAINT IF EXISTS "supplier_payable_receipts_code_unique";
ALTER TABLE "supplier_payable_receipts" DROP CONSTRAINT IF EXISTS "supplier_payable_receipts_client_request_id_unique";
ALTER TABLE "supplier_payable_entries" DROP CONSTRAINT IF EXISTS "supplier_payable_entries_code_unique";
ALTER TABLE "supplier_payable_entries" DROP CONSTRAINT IF EXISTS "supplier_payable_entries_client_request_id_unique";
ALTER TABLE "purchase_returns" DROP CONSTRAINT IF EXISTS "purchase_returns_code_unique";
ALTER TABLE "returns" DROP CONSTRAINT IF EXISTS "returns_code_unique";
ALTER TABLE "cash_transactions" DROP CONSTRAINT IF EXISTS "cash_transactions_code_unique";
ALTER TABLE "stocktakes" DROP CONSTRAINT IF EXISTS "stocktakes_code_unique";
ALTER TABLE "shifts" DROP CONSTRAINT IF EXISTS "shifts_code_unique";
ALTER TABLE "internal_use_issues" DROP CONSTRAINT IF EXISTS "internal_use_issues_code_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "brands_store_name_unique" ON "brands" ("store_id", "name");
CREATE UNIQUE INDEX "products_store_sku_unique" ON "products" ("store_id", "sku");
CREATE UNIQUE INDEX "customers_store_code_unique" ON "customers" ("store_id", "code") WHERE "code" IS NOT NULL;
CREATE UNIQUE INDEX "suppliers_store_code_unique" ON "suppliers" ("store_id", "code") WHERE "code" IS NOT NULL;
CREATE UNIQUE INDEX "orders_store_code_unique" ON "orders" ("store_id", "code");
CREATE UNIQUE INDEX "orders_store_client_id_unique" ON "orders" ("store_id", "client_id") WHERE "client_id" IS NOT NULL;
CREATE UNIQUE INDEX "customer_receivable_receipts_store_code_unique" ON "customer_receivable_receipts" ("store_id", "code");
CREATE UNIQUE INDEX "customer_receivable_receipts_store_client_unique" ON "customer_receivable_receipts" ("store_id", "client_request_id");
CREATE UNIQUE INDEX "customer_receivable_entries_store_code_unique" ON "customer_receivable_entries" ("store_id", "code");
CREATE UNIQUE INDEX "customer_receivable_entries_store_client_unique" ON "customer_receivable_entries" ("store_id", "client_request_id");
CREATE UNIQUE INDEX "purchase_orders_store_code_unique" ON "purchase_orders" ("store_id", "code");
CREATE UNIQUE INDEX "supplier_payable_receipts_store_code_unique" ON "supplier_payable_receipts" ("store_id", "code");
CREATE UNIQUE INDEX "supplier_payable_receipts_store_client_unique" ON "supplier_payable_receipts" ("store_id", "client_request_id");
CREATE UNIQUE INDEX "supplier_payable_entries_store_code_unique" ON "supplier_payable_entries" ("store_id", "code");
CREATE UNIQUE INDEX "supplier_payable_entries_store_client_unique" ON "supplier_payable_entries" ("store_id", "client_request_id");
CREATE UNIQUE INDEX "purchase_returns_store_code_unique" ON "purchase_returns" ("store_id", "code");
CREATE UNIQUE INDEX "returns_store_code_unique" ON "returns" ("store_id", "code");
DROP INDEX "returns_client_id_idx";
CREATE UNIQUE INDEX "returns_store_client_id_unique" ON "returns" ("store_id", "client_id") WHERE "client_id" IS NOT NULL;
CREATE UNIQUE INDEX "cash_transactions_store_code_unique" ON "cash_transactions" ("store_id", "code");
CREATE UNIQUE INDEX "stocktakes_store_code_unique" ON "stocktakes" ("store_id", "code");
CREATE UNIQUE INDEX "shifts_store_code_unique" ON "shifts" ("store_id", "code");
CREATE UNIQUE INDEX "internal_use_issues_store_code_unique" ON "internal_use_issues" ("store_id", "code");
--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_store_default_unique"
  ON "warehouses" ("store_id") WHERE "is_default" = true;
CREATE UNIQUE INDEX "price_books_store_default_unique"
  ON "price_books" ("store_id") WHERE "is_default" = true;
DROP INDEX "print_templates_default_doc_type_idx";
CREATE UNIQUE INDEX "print_templates_store_default_doc_type_idx"
  ON "print_templates" ("store_id", "doc_type")
  WHERE "is_default" = true AND "is_active" = true;
DROP INDEX "label_templates_default_idx";
CREATE UNIQUE INDEX "label_templates_store_default_idx"
  ON "label_templates" ("store_id")
  WHERE "is_default" = true AND "is_active" = true;
DROP INDEX "shifts_open_user_unique_idx";
CREATE UNIQUE INDEX "shifts_store_open_user_unique_idx"
  ON "shifts" ("store_id", "user_id") WHERE "status" = 'open';
--> statement-breakpoint
ALTER TABLE "stock_levels" DROP CONSTRAINT "stock_levels_product_id_warehouse_id_pk";
ALTER TABLE "stock_levels"
  ADD CONSTRAINT "stock_levels_store_product_warehouse_pk"
  PRIMARY KEY ("store_id", "product_id", "warehouse_id");
ALTER TABLE "stock_levels"
  ADD CONSTRAINT "stock_levels_store_product_fk"
  FOREIGN KEY ("store_id", "product_id")
  REFERENCES "products" ("store_id", "id") ON DELETE cascade;
ALTER TABLE "stock_levels"
  ADD CONSTRAINT "stock_levels_store_warehouse_fk"
  FOREIGN KEY ("store_id", "warehouse_id")
  REFERENCES "warehouses" ("store_id", "id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "product_prices"
  ADD CONSTRAINT "product_prices_store_book_fk"
  FOREIGN KEY ("store_id", "price_book_id") REFERENCES "price_books" ("store_id", "id") ON DELETE cascade;
ALTER TABLE "product_prices"
  ADD CONSTRAINT "product_prices_store_product_fk"
  FOREIGN KEY ("store_id", "product_id") REFERENCES "products" ("store_id", "id") ON DELETE cascade;
ALTER TABLE "product_suppliers"
  ADD CONSTRAINT "product_suppliers_store_product_fk"
  FOREIGN KEY ("store_id", "product_id") REFERENCES "products" ("store_id", "id") ON DELETE cascade;
ALTER TABLE "product_suppliers"
  ADD CONSTRAINT "product_suppliers_store_supplier_fk"
  FOREIGN KEY ("store_id", "supplier_id") REFERENCES "suppliers" ("store_id", "id") ON DELETE cascade;
ALTER TABLE "product_combo_items"
  ADD CONSTRAINT "product_combo_items_store_combo_fk"
  FOREIGN KEY ("store_id", "combo_product_id") REFERENCES "products" ("store_id", "id") ON DELETE cascade;
ALTER TABLE "product_combo_items"
  ADD CONSTRAINT "product_combo_items_store_component_fk"
  FOREIGN KEY ("store_id", "component_product_id") REFERENCES "products" ("store_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "products"
  ADD CONSTRAINT "products_store_category_fk"
  FOREIGN KEY ("store_id", "category_id") REFERENCES "categories" ("store_id", "id");
ALTER TABLE "products"
  ADD CONSTRAINT "products_store_brand_fk"
  FOREIGN KEY ("store_id", "brand_id") REFERENCES "brands" ("store_id", "id");
ALTER TABLE "products"
  ADD CONSTRAINT "products_store_supplier_fk"
  FOREIGN KEY ("store_id", "supplier_id") REFERENCES "suppliers" ("store_id", "id");
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_store_product_fk"
  FOREIGN KEY ("store_id", "product_id") REFERENCES "products" ("store_id", "id");
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_store_warehouse_fk"
  FOREIGN KEY ("store_id", "warehouse_id") REFERENCES "warehouses" ("store_id", "id");
--> statement-breakpoint
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_store_customer_fk"
  FOREIGN KEY ("store_id", "customer_id") REFERENCES "customers" ("store_id", "id");
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_store_warehouse_fk"
  FOREIGN KEY ("store_id", "warehouse_id") REFERENCES "warehouses" ("store_id", "id");
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_store_order_fk"
  FOREIGN KEY ("store_id", "order_id") REFERENCES "orders" ("store_id", "id") ON DELETE cascade;
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_store_product_fk"
  FOREIGN KEY ("store_id", "product_id") REFERENCES "products" ("store_id", "id");
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_store_order_fk"
  FOREIGN KEY ("store_id", "order_id") REFERENCES "orders" ("store_id", "id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "customer_receivable_receipts"
  ADD CONSTRAINT "customer_receivable_receipts_store_customer_fk"
  FOREIGN KEY ("store_id", "customer_id") REFERENCES "customers" ("store_id", "id");
ALTER TABLE "customer_receivable_allocations"
  ADD CONSTRAINT "customer_receivable_allocations_store_receipt_fk"
  FOREIGN KEY ("store_id", "receipt_id") REFERENCES "customer_receivable_receipts" ("store_id", "id") ON DELETE cascade;
ALTER TABLE "customer_receivable_allocations"
  ADD CONSTRAINT "customer_receivable_allocations_store_order_fk"
  FOREIGN KEY ("store_id", "order_id") REFERENCES "orders" ("store_id", "id");
ALTER TABLE "customer_receivable_entries"
  ADD CONSTRAINT "customer_receivable_entries_store_customer_fk"
  FOREIGN KEY ("store_id", "customer_id") REFERENCES "customers" ("store_id", "id");
ALTER TABLE "customer_receivable_entries"
  ADD CONSTRAINT "customer_receivable_entries_store_order_fk"
  FOREIGN KEY ("store_id", "order_id") REFERENCES "orders" ("store_id", "id");
--> statement-breakpoint
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_store_supplier_fk"
  FOREIGN KEY ("store_id", "supplier_id") REFERENCES "suppliers" ("store_id", "id");
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_store_warehouse_fk"
  FOREIGN KEY ("store_id", "warehouse_id") REFERENCES "warehouses" ("store_id", "id");
ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_store_purchase_fk"
  FOREIGN KEY ("store_id", "purchase_order_id") REFERENCES "purchase_orders" ("store_id", "id") ON DELETE cascade;
ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_store_product_fk"
  FOREIGN KEY ("store_id", "product_id") REFERENCES "products" ("store_id", "id");
ALTER TABLE "supplier_payable_receipts"
  ADD CONSTRAINT "supplier_payable_receipts_store_supplier_fk"
  FOREIGN KEY ("store_id", "supplier_id") REFERENCES "suppliers" ("store_id", "id");
ALTER TABLE "supplier_payable_allocations"
  ADD CONSTRAINT "supplier_payable_allocations_store_receipt_fk"
  FOREIGN KEY ("store_id", "receipt_id") REFERENCES "supplier_payable_receipts" ("store_id", "id") ON DELETE cascade;
ALTER TABLE "supplier_payable_allocations"
  ADD CONSTRAINT "supplier_payable_allocations_store_purchase_fk"
  FOREIGN KEY ("store_id", "purchase_order_id") REFERENCES "purchase_orders" ("store_id", "id");
ALTER TABLE "supplier_payable_entries"
  ADD CONSTRAINT "supplier_payable_entries_store_supplier_fk"
  FOREIGN KEY ("store_id", "supplier_id") REFERENCES "suppliers" ("store_id", "id");
ALTER TABLE "supplier_payable_entries"
  ADD CONSTRAINT "supplier_payable_entries_store_purchase_fk"
  FOREIGN KEY ("store_id", "purchase_order_id") REFERENCES "purchase_orders" ("store_id", "id");
--> statement-breakpoint
ALTER TABLE "stock_lots"
  ADD CONSTRAINT "stock_lots_store_product_fk"
  FOREIGN KEY ("store_id", "product_id") REFERENCES "products" ("store_id", "id") ON DELETE restrict;
ALTER TABLE "stock_lots"
  ADD CONSTRAINT "stock_lots_store_warehouse_fk"
  FOREIGN KEY ("store_id", "warehouse_id") REFERENCES "warehouses" ("store_id", "id") ON DELETE restrict;
ALTER TABLE "stock_lots"
  ADD CONSTRAINT "stock_lots_store_purchase_item_fk"
  FOREIGN KEY ("store_id", "purchase_order_item_id") REFERENCES "purchase_order_items" ("store_id", "id");
ALTER TABLE "purchase_returns"
  ADD CONSTRAINT "purchase_returns_store_purchase_fk"
  FOREIGN KEY ("store_id", "purchase_order_id") REFERENCES "purchase_orders" ("store_id", "id");
ALTER TABLE "purchase_returns"
  ADD CONSTRAINT "purchase_returns_store_supplier_fk"
  FOREIGN KEY ("store_id", "supplier_id") REFERENCES "suppliers" ("store_id", "id");
ALTER TABLE "purchase_returns"
  ADD CONSTRAINT "purchase_returns_store_warehouse_fk"
  FOREIGN KEY ("store_id", "warehouse_id") REFERENCES "warehouses" ("store_id", "id");
ALTER TABLE "purchase_return_items"
  ADD CONSTRAINT "purchase_return_items_store_return_fk"
  FOREIGN KEY ("store_id", "purchase_return_id") REFERENCES "purchase_returns" ("store_id", "id") ON DELETE cascade;
ALTER TABLE "purchase_return_items"
  ADD CONSTRAINT "purchase_return_items_store_purchase_item_fk"
  FOREIGN KEY ("store_id", "purchase_order_item_id") REFERENCES "purchase_order_items" ("store_id", "id");
ALTER TABLE "purchase_return_items"
  ADD CONSTRAINT "purchase_return_items_store_product_fk"
  FOREIGN KEY ("store_id", "product_id") REFERENCES "products" ("store_id", "id");
--> statement-breakpoint
ALTER TABLE "returns"
  ADD CONSTRAINT "returns_store_order_fk"
  FOREIGN KEY ("store_id", "order_id") REFERENCES "orders" ("store_id", "id");
ALTER TABLE "returns"
  ADD CONSTRAINT "returns_store_customer_fk"
  FOREIGN KEY ("store_id", "customer_id") REFERENCES "customers" ("store_id", "id");
ALTER TABLE "returns"
  ADD CONSTRAINT "returns_store_warehouse_fk"
  FOREIGN KEY ("store_id", "warehouse_id") REFERENCES "warehouses" ("store_id", "id");
ALTER TABLE "returns"
  ADD CONSTRAINT "returns_store_exchange_order_fk"
  FOREIGN KEY ("store_id", "exchange_order_id") REFERENCES "orders" ("store_id", "id");
ALTER TABLE "return_items"
  ADD CONSTRAINT "return_items_store_return_fk"
  FOREIGN KEY ("store_id", "return_id") REFERENCES "returns" ("store_id", "id") ON DELETE cascade;
ALTER TABLE "return_items"
  ADD CONSTRAINT "return_items_store_order_item_fk"
  FOREIGN KEY ("store_id", "order_item_id") REFERENCES "order_items" ("store_id", "id");
ALTER TABLE "return_items"
  ADD CONSTRAINT "return_items_store_product_fk"
  FOREIGN KEY ("store_id", "product_id") REFERENCES "products" ("store_id", "id");
ALTER TABLE "payment_refunds"
  ADD CONSTRAINT "payment_refunds_store_return_fk"
  FOREIGN KEY ("store_id", "return_id") REFERENCES "returns" ("store_id", "id") ON DELETE restrict;
ALTER TABLE "payment_refunds"
  ADD CONSTRAINT "payment_refunds_store_payment_fk"
  FOREIGN KEY ("store_id", "payment_id") REFERENCES "payments" ("store_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "stocktakes"
  ADD CONSTRAINT "stocktakes_store_warehouse_fk"
  FOREIGN KEY ("store_id", "warehouse_id") REFERENCES "warehouses" ("store_id", "id");
ALTER TABLE "stocktake_items"
  ADD CONSTRAINT "stocktake_items_store_stocktake_fk"
  FOREIGN KEY ("store_id", "stocktake_id") REFERENCES "stocktakes" ("store_id", "id") ON DELETE cascade;
ALTER TABLE "stocktake_items"
  ADD CONSTRAINT "stocktake_items_store_product_fk"
  FOREIGN KEY ("store_id", "product_id") REFERENCES "products" ("store_id", "id");
ALTER TABLE "internal_use_issues"
  ADD CONSTRAINT "internal_use_issues_store_warehouse_fk"
  FOREIGN KEY ("store_id", "warehouse_id") REFERENCES "warehouses" ("store_id", "id");
ALTER TABLE "internal_use_items"
  ADD CONSTRAINT "internal_use_items_store_issue_fk"
  FOREIGN KEY ("store_id", "issue_id") REFERENCES "internal_use_issues" ("store_id", "id") ON DELETE cascade;
ALTER TABLE "internal_use_items"
  ADD CONSTRAINT "internal_use_items_store_product_fk"
  FOREIGN KEY ("store_id", "product_id") REFERENCES "products" ("store_id", "id");
