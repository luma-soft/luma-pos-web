ALTER TABLE public.purchase_orders ADD COLUMN shipping_fee numeric(14, 2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_shipping_fee_nonnegative CHECK (shipping_fee >= 0);
