import { createHmac } from "crypto";
import { NextResponse } from "next/server";
import { getShopeeSettings } from "@/lib/data/settings";
import { Routes } from "@/lib/routes";

function baseUrl(environment: string) {
  return environment === "production" ? "https://partner.shopeemobile.com" : "https://partner.test-stable.shopeemobile.com";
}

export async function GET(req: Request) {
  const settings = await getShopeeSettings();
  const url = new URL(req.url);
  if (!settings.partnerId || !settings.partnerKey) {
    const target = new URL(Routes.OnlineSales, url.origin);
    target.searchParams.set("tab", "channels");
    target.searchParams.set("error", "missing_shopee_partner_credentials");
    return NextResponse.redirect(target);
  }
  const partnerId = Number(settings.partnerId);
  if (!Number.isSafeInteger(partnerId) || partnerId <= 0) {
    const target = new URL(Routes.OnlineSales, url.origin);
    target.searchParams.set("tab", "channels");
    target.searchParams.set("error", "invalid_shopee_partner_id");
    return NextResponse.redirect(target);
  }
  const origin = `${url.protocol}//${url.host}`;
  const redirect = `${origin}${settings.redirectPath || "/api/shopee/callback"}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const path = "/api/v2/shop/auth_partner";
  const base = `${partnerId}${path}${timestamp}`;
  const sign = createHmac("sha256", settings.partnerKey).update(base).digest("hex");
  const target = new URL(`${baseUrl(settings.environment)}${path}`);
  target.searchParams.set("partner_id", String(partnerId));
  target.searchParams.set("timestamp", String(timestamp));
  target.searchParams.set("sign", sign);
  target.searchParams.set("redirect", redirect);
  return NextResponse.redirect(target);
}
