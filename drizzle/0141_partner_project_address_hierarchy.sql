ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS address_line text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address_province_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address_ward_code text NOT NULL DEFAULT '';

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS address_line text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address_province_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address_ward_code text NOT NULL DEFAULT '';

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS address_line text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address_province_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address_ward_code text NOT NULL DEFAULT '';
