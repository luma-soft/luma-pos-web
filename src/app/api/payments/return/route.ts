export async function GET() {
  return new Response(
    "<!doctype html><html lang=\"vi\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>LumaPOS Payment</title><body style=\"font-family:system-ui;padding:32px;max-width:560px;margin:auto\"><h1>Đang xác minh thanh toán</h1><p>Bạn có thể quay lại LumaPOS. Giao dịch chỉ hoàn tất sau khi máy chủ nhận xác nhận hợp lệ từ nhà cung cấp.</p></body></html>",
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
