import { createHmac } from "crypto";
import { NextResponse } from "next/server";
import { getShopeeSettings } from "@/lib/data/settings";

function baseUrl(environment: string) {
  return environment === "production" ? "https://partner.shopeemobile.com" : "https://partner.test-stable.shopeemobile.com";
}

export async function GET(req: Request) {
  const settings = await getShopeeSettings();
  if (!settings.partnerId || !settings.partnerKey) {
    return NextResponse.json({ ok: false, error: "missing_shopee_partner_credentials" }, { status: 400 });
  }
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;
  const redirect = `${origin}${settings.redirectPath || "/api/shopee/callback"}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const path = "/api/v2/shop/auth_partner";
  const partnerId = Number(settings.partnerId);
  const base = `${partnerId}${path}${timestamp}`;
  const sign = createHmac("sha256", settings.partnerKey).update(base).digest("hex");
  const target = new URL(`${baseUrl(settings.environment)}${path}`);
  target.searchParams.set("partner_id", String(partnerId));
  target.searchParams.set("timestamp", String(timestamp));
  target.searchParams.set("sign", sign);
  target.searchParams.set("redirect", redirect);
  return NextResponse.redirect(target);
}
