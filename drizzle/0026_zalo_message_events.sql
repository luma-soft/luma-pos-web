CREATE TABLE "zalo_message_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"customer_id" uuid,
	"order_id" uuid,
	"invoice_id" uuid,
	"phone" varchar(30),
	"template_id" varchar(80),
	"zalo_message_id" text,
	"payload_summary" jsonb,
	"error_code" text,
	"error_message" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "zalo_message_events" ADD CONSTRAINT "zalo_message_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "zalo_message_events" ADD CONSTRAINT "zalo_message_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "zalo_message_events" ADD CONSTRAINT "zalo_message_events_invoice_id_einvoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."einvoices"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "zalo_message_events" ADD CONSTRAINT "zalo_message_events_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "zalo_message_events_kind_status_idx" ON "zalo_message_events" USING btree ("kind","status","created_at");
--> statement-breakpoint
CREATE INDEX "zalo_message_events_customer_idx" ON "zalo_message_events" USING btree ("customer_id","created_at");
--> statement-breakpoint
CREATE INDEX "zalo_message_events_order_idx" ON "zalo_message_events" USING btree ("order_id","created_at");
