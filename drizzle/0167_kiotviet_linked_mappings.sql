-- `linked`: a KiotViet document that Luma POS already recorded on its own
-- (for example a POS order mirrored in KiotViet). The mapping stops later
-- syncs from creating it again, and the POS record stays authoritative.
ALTER TABLE public.kiotviet_source_mappings
  DROP CONSTRAINT kiotviet_source_mappings_adoption_method_check;
--> statement-breakpoint
ALTER TABLE public.kiotviet_source_mappings
  ADD CONSTRAINT kiotviet_source_mappings_adoption_method_check
  CHECK (adoption_method IN ('mapped', 'created', 'legacy_adopted', 'linked'));
