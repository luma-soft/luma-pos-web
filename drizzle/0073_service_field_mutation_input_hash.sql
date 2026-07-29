ALTER TABLE "service_field_mutations"
  ADD COLUMN "input_hash" varchar(64);
--> statement-breakpoint
ALTER TABLE "service_field_mutations"
  ADD CONSTRAINT "service_field_mutations_input_hash_check"
  CHECK ("input_hash" IS NULL OR "input_hash" ~ '^[0-9a-f]{64}$');
