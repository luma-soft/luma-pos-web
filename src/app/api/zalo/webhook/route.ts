import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getZaloConfig } from "@/lib/zalo/config";

function verifySignature(secret: string, body: string, signature: string | null) {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const normalized = signature.replace(/^sha256=/i, "");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(normalized, "hex");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export async function POST(request: Request) {
  const body = await request.text();
  const config = await getZaloConfig();
  if (config.webhookSecret) {
    const signature = request.headers.get("x-zalo-signature") ?? request.headers.get("x-hub-signature-256");
    if (!verifySignature(config.webhookSecret, body, signature)) {
      return NextResponse.json({ ok: false, error: "errors.forbidden" }, { status: 403 });
    }
  }
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(body || "{}") as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "errors.invalidData" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, received: Boolean(event) });
}
