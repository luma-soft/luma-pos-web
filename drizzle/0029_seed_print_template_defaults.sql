INSERT INTO "print_templates" (
  "name",
  "doc_type",
  "paper_default",
  "is_default",
  "is_active",
  "sort_order",
  "footer_note",
  "options"
)
SELECT *
FROM (VALUES
  (
    'Mẫu hóa đơn mặc định',
    'order'::print_doc_type,
    'a5'::paper_size,
    true,
    true,
    0,
    'Vui lòng kiểm tra hàng khi nhận. Hàng nguyên kiện chưa khui được đổi/trả trong 7 ngày.',
    '{"showSeller":true,"showProject":true,"showDebt":true,"showDiscount":true,"showTax":true,"showLineDiscount":true,"showInWords":true,"showSignatures":true,"showSku":false}'::jsonb
  ),
  (
    'Mẫu báo giá mặc định',
    'quote'::print_doc_type,
    'a4'::paper_size,
    true,
    true,
    0,
    'Báo giá có hiệu lực trong 7 ngày. Giá chưa gồm vận chuyển nếu không ghi rõ.',
    '{"showSeller":true,"showProject":true,"showDebt":true,"showDiscount":true,"showTax":true,"showLineDiscount":true,"showInWords":true,"showSignatures":true,"showSku":false}'::jsonb
  ),
  (
    'Mẫu đặt hàng mặc định',
    'booking'::print_doc_type,
    'a4'::paper_size,
    true,
    true,
    0,
    'Phiếu đặt hàng chưa phải hóa đơn bán hàng. Vui lòng xác nhận lại thời gian giao trước khi xuất kho.',
    '{"showSeller":true,"showProject":true,"showDebt":true,"showDiscount":true,"showTax":true,"showLineDiscount":true,"showInWords":true,"showSignatures":true,"showSku":false}'::jsonb
  ),
  (
    'Mẫu nhập hàng mặc định',
    'purchase'::print_doc_type,
    'a4'::paper_size,
    true,
    true,
    0,
    'Đề nghị NCC giao đúng chủng loại, quy cách. Hàng hư hỏng vỡ bể sẽ trả lại.',
    '{"showSeller":true,"showProject":true,"showDebt":true,"showDiscount":true,"showTax":true,"showLineDiscount":true,"showInWords":true,"showSignatures":true,"showSku":false}'::jsonb
  ),
  (
    'Mẫu trả hàng mặc định',
    'return'::print_doc_type,
    'a5'::paper_size,
    true,
    true,
    0,
    'Biên nhận trả hàng — kèm theo hóa đơn gốc.',
    '{"showSeller":true,"showProject":true,"showDebt":true,"showDiscount":true,"showTax":true,"showLineDiscount":true,"showInWords":true,"showSignatures":true,"showSku":false}'::jsonb
  ),
  (
    'Mẫu biên nhận mặc định',
    'receipt'::print_doc_type,
    'a5'::paper_size,
    true,
    true,
    0,
    '',
    '{"showSeller":true,"showProject":true,"showDebt":true,"showDiscount":true,"showTax":true,"showLineDiscount":true,"showInWords":true,"showSignatures":true,"showSku":false}'::jsonb
  )
) AS defaults("name", "doc_type", "paper_default", "is_default", "is_active", "sort_order", "footer_note", "options")
WHERE NOT EXISTS (
  SELECT 1
  FROM "print_templates"
  WHERE "print_templates"."doc_type" = defaults."doc_type"
);
