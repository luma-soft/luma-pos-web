ALTER TABLE public.service_customer_request_storage_cleanup
  ADD COLUMN provider text NOT NULL DEFAULT 'supabase';
--> statement-breakpoint
ALTER TABLE public.service_customer_request_storage_cleanup
  ADD CONSTRAINT service_customer_request_cleanup_provider_check
  CHECK (provider IN ('local', 'r2', 'supabase'));
