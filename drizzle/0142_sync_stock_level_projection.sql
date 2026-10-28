CREATE OR REPLACE FUNCTION sync_product_stock(p uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE products
  SET total_stock = coalesce((SELECT sum(quantity) FROM stock_levels WHERE product_id = p), 0),
      min_stock = coalesce((SELECT max(min_level) FROM stock_levels WHERE product_id = p), 0)
  WHERE id = p;
$$;

CREATE OR REPLACE FUNCTION trg_sync_product_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM sync_product_stock(OLD.product_id);
  ELSE
    PERFORM sync_product_stock(NEW.product_id);
    IF TG_OP = 'UPDATE' AND NEW.product_id <> OLD.product_id THEN
      PERFORM sync_product_stock(OLD.product_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS stock_levels_sync ON stock_levels;
CREATE TRIGGER stock_levels_sync
  AFTER INSERT OR UPDATE OR DELETE ON stock_levels
  FOR EACH ROW EXECUTE FUNCTION trg_sync_product_stock();

UPDATE products p
SET total_stock = coalesce((SELECT sum(quantity) FROM stock_levels WHERE product_id = p.id), 0),
    min_stock = coalesce((SELECT max(min_level) FROM stock_levels WHERE product_id = p.id), 0);
