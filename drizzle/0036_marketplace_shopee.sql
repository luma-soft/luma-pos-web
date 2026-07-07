CREATE TABLE IF NOT EXISTS marketplace_shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'shopee',
  shop_id text NOT NULL,
  shop_name text NOT NULL DEFAULT '',
  region varchar(10) NOT NULL DEFAULT 'VN',
  status text NOT NULL DEFAULT 'disconnected',
  connected_at timestamptz,
  disconnected_at timestamptz,
  token_expires_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  metadata jsonb,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_shops_provider_shop_idx ON marketplace_shops(provider, shop_id);
CREATE INDEX IF NOT EXISTS marketplace_shops_provider_status_idx ON marketplace_shops(provider, status);

CREATE TABLE IF NOT EXISTS marketplace_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES marketplace_shops(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_tokens_shop_idx ON marketplace_tokens(shop_id);

CREATE TABLE IF NOT EXISTS marketplace_product_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'shopee',
  shop_id uuid REFERENCES marketplace_shops(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  external_item_id text,
  external_model_id text,
  external_sku text,
  status text NOT NULL DEFAULT 'draft',
  title text NOT NULL DEFAULT '',
  category_id text,
  category_path text,
  price numeric(14,2),
  stock numeric(14,4),
  sync_mode text NOT NULL DEFAULT 'luma_to_shopee',
  min_stock_threshold numeric(14,4) NOT NULL DEFAULT 0,
  out_of_stock_behavior text NOT NULL DEFAULT 'keep_visible',
  draft_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_payload jsonb,
  last_response jsonb,
  last_sync_at timestamptz,
  last_error text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_product_mappings_provider_product_idx ON marketplace_product_mappings(provider, product_id);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_product_mappings_external_idx ON marketplace_product_mappings(provider, external_item_id);
CREATE INDEX IF NOT EXISTS marketplace_product_mappings_status_idx ON marketplace_product_mappings(provider, status);

CREATE TABLE IF NOT EXISTS marketplace_order_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'shopee',
  shop_id uuid REFERENCES marketplace_shops(id) ON DELETE SET NULL,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  external_order_sn text NOT NULL,
  external_status text NOT NULL DEFAULT '',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_order_mappings_provider_order_idx ON marketplace_order_mappings(provider, external_order_sn);
CREATE INDEX IF NOT EXISTS marketplace_order_mappings_luma_order_idx ON marketplace_order_mappings(order_id);

CREATE TABLE IF NOT EXISTS marketplace_message_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'shopee',
  shop_id uuid REFERENCES marketplace_shops(id) ON DELETE SET NULL,
  external_thread_id text NOT NULL,
  external_buyer_id text,
  buyer_name text NOT NULL DEFAULT '',
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open',
  last_message_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_message_threads_provider_thread_idx ON marketplace_message_threads(provider, external_thread_id);
CREATE INDEX IF NOT EXISTS marketplace_message_threads_last_idx ON marketplace_message_threads(provider, last_message_at);

CREATE TABLE IF NOT EXISTS marketplace_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES marketplace_message_threads(id) ON DELETE CASCADE,
  external_message_id text,
  direction text NOT NULL,
  body text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_payload jsonb,
  sent_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_messages_external_idx ON marketplace_messages(thread_id, external_message_id);
CREATE INDEX IF NOT EXISTS marketplace_messages_thread_idx ON marketplace_messages(thread_id, sent_at);

CREATE TABLE IF NOT EXISTS marketplace_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'shopee',
  shop_id uuid REFERENCES marketplace_shops(id) ON DELETE SET NULL,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_response jsonb,
  last_error text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_sync_jobs_idempotency_idx ON marketplace_sync_jobs(provider, idempotency_key);
CREATE INDEX IF NOT EXISTS marketplace_sync_jobs_status_idx ON marketplace_sync_jobs(provider, status, next_run_at);

CREATE TABLE IF NOT EXISTS ai_listing_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'shopee',
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  mapping_id uuid REFERENCES marketplace_product_mappings(id) ON DELETE SET NULL,
  model text NOT NULL DEFAULT '',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggestion jsonb NOT NULL DEFAULT '{}'::jsonb,
  edited_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  reverted_reason text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_listing_suggestions_product_idx ON ai_listing_suggestions(product_id, created_at);
