UPDATE "print_templates"
SET "options" = coalesce("options", '{}'::jsonb)
  || '{"showDiscount":true,"showTax":true,"showLineDiscount":true}'::jsonb
WHERE NOT ("options" ? 'showDiscount')
   OR NOT ("options" ? 'showTax')
   OR NOT ("options" ? 'showLineDiscount');
