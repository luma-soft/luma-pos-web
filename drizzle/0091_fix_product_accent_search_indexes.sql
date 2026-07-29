-- Tạo lại index với đúng phép chuẩn hoá dấu tiếng Việt cho các database
-- đã chạy migration 0090 trước khi chuỗi thay thế được chuẩn hoá.
DROP INDEX CONCURRENTLY IF EXISTS "products_name_accent_trgm_idx";
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "products_sku_accent_trgm_idx";
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "products_barcode_accent_trgm_idx";
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_name_accent_trgm_idx"
  ON "products" USING gin (translate(lower("name"), 'áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd') gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_sku_accent_trgm_idx"
  ON "products" USING gin (translate(lower("sku"), 'áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd') gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_barcode_accent_trgm_idx"
  ON "products" USING gin (translate(lower("barcode"), 'áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd') gin_trgm_ops);
