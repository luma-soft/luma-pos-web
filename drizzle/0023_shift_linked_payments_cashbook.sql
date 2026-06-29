CREATE TABLE IF NOT EXISTS "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(30) NOT NULL,
	"user_id" uuid,
	"opening_float" numeric(14, 2) DEFAULT '0' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"expected_cash" numeric(14, 2),
	"counted_cash" numeric(14, 2),
	"variance" numeric(14, 2),
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_code_unique" UNIQUE("code")
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shifts" ADD CONSTRAINT "shifts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shifts_status_idx" ON "shifts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shifts_user_idx" ON "shifts" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "shift_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_shift_idx" ON "orders" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_shift_idx" ON "payments" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cash_tx_shift_idx" ON "cash_transactions" USING btree ("shift_id");
