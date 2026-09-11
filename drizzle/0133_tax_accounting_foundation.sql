ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_activity_id varchar(80);
CREATE INDEX IF NOT EXISTS products_tax_activity_idx ON products(store_id, tax_activity_id) WHERE tax_activity_id IS NOT NULL;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tax_activity_id varchar(80);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tax_activity_name text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS vat_revenue_rate numeric(5,2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS pit_revenue_rate numeric(5,2);

ALTER TABLE return_items ADD COLUMN IF NOT EXISTS tax_activity_id varchar(80);
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS tax_activity_name text;
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS vat_revenue_rate numeric(5,2);
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS pit_revenue_rate numeric(5,2);

ALTER TABLE payment_bank_accounts ADD COLUMN IF NOT EXISTS tax_registration_status varchar(20) NOT NULL DEFAULT 'not_declared';
ALTER TABLE payment_bank_accounts ADD COLUMN IF NOT EXISTS tax_registered_at timestamptz;
DO $$ BEGIN
  ALTER TABLE payment_bank_accounts ADD CONSTRAINT payment_bank_accounts_tax_registration_check
    CHECK (tax_registration_status IN ('not_declared', 'declared', 'inactive'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tax_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period_type varchar(20) NOT NULL,
  period_key varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  revenue numeric(14,2) NOT NULL DEFAULT 0,
  vat_amount numeric(14,2) NOT NULL DEFAULT 0,
  pit_amount numeric(14,2) NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  authority_reference text,
  note text,
  submitted_by uuid REFERENCES profiles(id),
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_declarations_period_type_check CHECK (period_type IN ('monthly', 'quarterly', 'annual', 'per_occurrence')),
  CONSTRAINT tax_declarations_status_check CHECK (status IN ('draft', 'ready', 'submitted', 'accepted', 'rejected'))
);
CREATE UNIQUE INDEX IF NOT EXISTS tax_declarations_store_period_unique ON tax_declarations(store_id, period_type, period_key);
CREATE INDEX IF NOT EXISTS tax_declarations_store_status_idx ON tax_declarations(store_id, status);

CREATE TABLE IF NOT EXISTS other_tax_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  occurred_on date NOT NULL,
  tax_type varchar(40) NOT NULL,
  description text NOT NULL,
  reference text,
  payable_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  due_on date,
  paid_on date,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT other_tax_obligations_amount_check CHECK (payable_amount >= 0 AND paid_amount >= 0 AND paid_amount <= payable_amount)
);
CREATE INDEX IF NOT EXISTS other_tax_obligations_store_date_idx ON other_tax_obligations(store_id, occurred_on);

ALTER TABLE tax_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE other_tax_obligations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE tax_declarations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE other_tax_obligations FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION snapshot_order_item_tax_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE activity jsonb;
BEGIN
  IF NEW.tax_activity_id IS NULL THEN
    SELECT p.tax_activity_id INTO NEW.tax_activity_id
    FROM products p WHERE p.id = NEW.product_id AND p.store_id = NEW.store_id;
  END IF;
  SELECT candidate INTO activity
  FROM store_settings s
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.prefs->'tax'->'businessActivities', '[]'::jsonb)) candidate
  WHERE s.store_id = NEW.store_id
    AND COALESCE((candidate->>'enabled')::boolean, true)
    AND (candidate->>'id' = NEW.tax_activity_id OR (
      NEW.tax_activity_id IS NULL AND 1 = (
        SELECT count(*) FROM jsonb_array_elements(COALESCE(s.prefs->'tax'->'businessActivities', '[]'::jsonb)) enabled
        WHERE COALESCE((enabled->>'enabled')::boolean, true)
      )
    ))
  LIMIT 1;
  IF activity IS NOT NULL THEN
    NEW.tax_activity_id := activity->>'id';
    NEW.tax_activity_name := activity->>'name';
    NEW.vat_revenue_rate := NULLIF(activity->>'vatRate', '')::numeric;
    NEW.pit_revenue_rate := NULLIF(activity->>'pitRate', '')::numeric;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION snapshot_return_item_tax_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE source_item order_items%ROWTYPE;
BEGIN
  IF NEW.order_item_id IS NOT NULL THEN
    SELECT * INTO source_item FROM order_items WHERE id = NEW.order_item_id AND store_id = NEW.store_id;
    NEW.tax_activity_id := source_item.tax_activity_id;
    NEW.tax_activity_name := source_item.tax_activity_name;
    NEW.vat_revenue_rate := source_item.vat_revenue_rate;
    NEW.pit_revenue_rate := source_item.pit_revenue_rate;
    RETURN NEW;
  END IF;
  RETURN snapshot_order_item_tax_activity_for_return(NEW);
END $$;

CREATE OR REPLACE FUNCTION snapshot_order_item_tax_activity_for_return(input return_items)
RETURNS return_items LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE activity jsonb;
BEGIN
  IF input.tax_activity_id IS NULL THEN
    SELECT p.tax_activity_id INTO input.tax_activity_id FROM products p WHERE p.id = input.product_id AND p.store_id = input.store_id;
  END IF;
  SELECT candidate INTO activity FROM store_settings s
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.prefs->'tax'->'businessActivities', '[]'::jsonb)) candidate
  WHERE s.store_id = input.store_id AND COALESCE((candidate->>'enabled')::boolean, true)
    AND candidate->>'id' = input.tax_activity_id LIMIT 1;
  IF activity IS NOT NULL THEN
    input.tax_activity_name := activity->>'name';
    input.vat_revenue_rate := NULLIF(activity->>'vatRate', '')::numeric;
    input.pit_revenue_rate := NULLIF(activity->>'pitRate', '')::numeric;
  END IF;
  RETURN input;
END $$;

DROP TRIGGER IF EXISTS order_items_tax_activity_snapshot ON order_items;
CREATE TRIGGER order_items_tax_activity_snapshot BEFORE INSERT ON order_items
FOR EACH ROW EXECUTE FUNCTION snapshot_order_item_tax_activity();
DROP TRIGGER IF EXISTS return_items_tax_activity_snapshot ON return_items;
CREATE TRIGGER return_items_tax_activity_snapshot BEFORE INSERT ON return_items
FOR EACH ROW EXECUTE FUNCTION snapshot_return_item_tax_activity();

UPDATE order_items oi SET tax_activity_id = p.tax_activity_id
FROM products p
WHERE p.id = oi.product_id AND p.store_id = oi.store_id
  AND oi.tax_activity_id IS NULL AND p.tax_activity_id IS NOT NULL;

UPDATE order_items oi SET tax_activity_id = (
  SELECT candidate->>'id' FROM store_settings s
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.prefs->'tax'->'businessActivities', '[]'::jsonb)) candidate
  WHERE s.store_id = oi.store_id AND COALESCE((candidate->>'enabled')::boolean, true)
  LIMIT 1
)
WHERE oi.tax_activity_id IS NULL AND 1 = (
  SELECT count(*) FROM store_settings s
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.prefs->'tax'->'businessActivities', '[]'::jsonb)) candidate
  WHERE s.store_id = oi.store_id AND COALESCE((candidate->>'enabled')::boolean, true)
);

UPDATE order_items oi SET
  tax_activity_name = activity.value->>'name',
  vat_revenue_rate = NULLIF(activity.value->>'vatRate', '')::numeric,
  pit_revenue_rate = NULLIF(activity.value->>'pitRate', '')::numeric
FROM store_settings s
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.prefs->'tax'->'businessActivities', '[]'::jsonb)) activity(value)
WHERE s.store_id = oi.store_id AND activity.value->>'id' = oi.tax_activity_id
  AND oi.tax_activity_name IS NULL;

UPDATE return_items ri SET
  tax_activity_id = oi.tax_activity_id,
  tax_activity_name = oi.tax_activity_name,
  vat_revenue_rate = oi.vat_revenue_rate,
  pit_revenue_rate = oi.pit_revenue_rate
FROM order_items oi
WHERE ri.order_item_id = oi.id AND ri.store_id = oi.store_id AND ri.tax_activity_id IS NULL;
