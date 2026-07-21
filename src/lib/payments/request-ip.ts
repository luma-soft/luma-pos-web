export function paymentRequestIp(request: Request) {
  const value = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "127.0.0.1";
  return /^[0-9a-f:.]{3,45}$/i.test(value) ? value : "127.0.0.1";
}
