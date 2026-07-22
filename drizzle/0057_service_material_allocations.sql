CREATE TABLE "service_material_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "material_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "quantity" numeric(14,4) NOT NULL,
  "remaining_quantity" numeric(14,4) NOT NULL,
  "status" text NOT NULL DEFAULT 'reserved',
  "created_by" uuid,
  "released_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_material_allocations_status_check" CHECK ("status" IN ('reserved', 'consumed', 'released')),
  CONSTRAINT "service_material_allocations_quantity_check" CHECK ("quantity" > 0 AND "remaining_quantity" >= 0 AND "remaining_quantity" <= "quantity")
);
--> statement-breakpoint
ALTER TABLE "service_material_allocations" ADD CONSTRAINT "service_material_allocations_material_id_service_job_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."service_job_materials"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_material_allocations" ADD CONSTRAINT "service_material_allocations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_material_allocations" ADD CONSTRAINT "service_material_allocations_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "service_material_allocations_material_idx" ON "service_material_allocations" ("material_id", "status");
--> statement-breakpoint
CREATE INDEX "service_material_allocations_warehouse_idx" ON "service_material_allocations" ("warehouse_id", "status");
