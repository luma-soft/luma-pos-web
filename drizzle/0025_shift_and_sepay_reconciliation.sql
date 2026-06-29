CREATE UNIQUE INDEX IF NOT EXISTS "shifts_open_user_unique_idx"
ON "shifts" USING btree ("user_id")
WHERE "status" = 'open';
