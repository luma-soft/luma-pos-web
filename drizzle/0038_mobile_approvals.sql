CREATE TABLE "mobile_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"requester_id" uuid NOT NULL,
	"approver_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"scope" text,
	"mode" text NOT NULL,
	"reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_approvals_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "mobile_approvals" ADD CONSTRAINT "mobile_approvals_requester_id_profiles_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mobile_approvals" ADD CONSTRAINT "mobile_approvals_approver_id_profiles_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "mobile_approvals_requester_idx" ON "mobile_approvals" USING btree ("requester_id","created_at");
--> statement-breakpoint
CREATE INDEX "mobile_approvals_expiry_idx" ON "mobile_approvals" USING btree ("expires_at");
