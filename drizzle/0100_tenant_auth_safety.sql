ALTER TABLE "profiles" ADD COLUMN "phone_normalized" text;
--> statement-breakpoint
UPDATE "profiles"
SET "phone_normalized" = CASE
  WHEN "phone" IS NULL OR btrim("phone") = '' THEN NULL
  WHEN regexp_replace("phone", '[^0-9]', '', 'g') ~ '^0[0-9]{9,10}$'
    THEN '+84' || substring(regexp_replace("phone", '[^0-9]', '', 'g') from 2)
  WHEN regexp_replace("phone", '[^0-9]', '', 'g') ~ '^84[0-9]{9,10}$'
    THEN '+' || regexp_replace("phone", '[^0-9]', '', 'g')
  WHEN btrim("phone") ~ '^\+[1-9][0-9 ()\.\-]{7,18}$'
    THEN '+' || regexp_replace("phone", '[^0-9]', '', 'g')
  ELSE NULL
END;
--> statement-breakpoint
DO $$
DECLARE duplicate_phone text;
BEGIN
  SELECT phone_normalized INTO duplicate_phone
  FROM profiles
  WHERE phone_normalized IS NOT NULL
  GROUP BY phone_normalized
  HAVING count(*) > 1
  LIMIT 1;

  IF duplicate_phone IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate normalized profile phone: %', duplicate_phone;
  END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_phone_normalized_unique"
  ON "profiles" ("phone_normalized")
  WHERE "phone_normalized" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_store_id_id_unique" UNIQUE ("store_id", "id");
--> statement-breakpoint
ALTER TABLE "mobile_approvals"
  ADD COLUMN "store_id" uuid
  DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "mobile_approvals"
  ALTER COLUMN "store_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "mobile_approvals"
  ADD CONSTRAINT "mobile_approvals_store_id_stores_id_fk"
  FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "mobile_approvals"
  ADD CONSTRAINT "mobile_approvals_store_requester_fk"
  FOREIGN KEY ("store_id", "requester_id")
  REFERENCES "public"."profiles"("store_id", "id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "mobile_approvals"
  ADD CONSTRAINT "mobile_approvals_store_approver_fk"
  FOREIGN KEY ("store_id", "approver_id")
  REFERENCES "public"."profiles"("store_id", "id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "mobile_approvals_store_requester_idx"
  ON "mobile_approvals" ("store_id", "requester_id", "created_at");
--> statement-breakpoint
ALTER TABLE "staff_invitations"
  ADD CONSTRAINT "staff_invitations_store_inviter_fk"
  FOREIGN KEY ("store_id", "invited_by")
  REFERENCES "public"."profiles"("store_id", "id");
