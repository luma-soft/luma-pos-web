UPDATE "print_templates"
SET "options" = coalesce("options", '{}'::jsonb)
  || CASE "doc_type"
    WHEN 'quote' THEN '{"showDebt":false,"showPaymentQr":false,"alwaysShowPaymentQr":false}'::jsonb
    WHEN 'booking' THEN '{"showPaymentQr":false,"alwaysShowPaymentQr":false}'::jsonb
    WHEN 'purchase' THEN '{"showProject":false,"showDeliveryAddress":false,"showPaymentQr":false,"alwaysShowPaymentQr":false}'::jsonb
    WHEN 'return' THEN '{"showProject":false,"showDeliveryAddress":false,"showDebt":false,"showDiscount":false,"showTax":false,"showLineDiscount":false,"showPaymentQr":false,"alwaysShowPaymentQr":false}'::jsonb
    WHEN 'receipt' THEN '{"showProject":false,"showPartyPhone":false,"showDeliveryAddress":false,"showDebt":false,"showDiscount":false,"showTax":false,"showLineDiscount":false,"showPaymentQr":false,"alwaysShowPaymentQr":false,"showSku":false}'::jsonb
    ELSE '{}'::jsonb
  END,
  "updated_at" = now()
WHERE "doc_type" <> 'order';
