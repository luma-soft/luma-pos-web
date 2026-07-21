CREATE UNIQUE INDEX IF NOT EXISTS "payments_manual_client_request_idx"
ON "payments" USING btree ("client_request_id")
WHERE "provider" IS NULL AND "client_request_id" IS NOT NULL;
