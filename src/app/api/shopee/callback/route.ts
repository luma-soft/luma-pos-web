import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { marketplaceShops, marketplaceTokens } from "@/db/schema";
import { Routes } from "@/lib/routes";
import { exchangeShopeeAuthorizationCode } from "@/lib/shopee/client";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const shopId = url.searchParams.get("shop_id") || url.searchParams.get("shopId") || "";
  const code = url.searchParams.get("code") || "";
  const error = url.searchParams.get("error") || "";

  if (error || !shopId) {
    const target = new URL(Routes.OnlineSales, url.origin);
    target.searchParams.set("error", error || "missing_shop_id");
    return NextResponse.redirect(target);
  }

  try {
    const [shopRow] = await db.insert(marketplaceShops)
      .values({
        provider: "shopee",
        shopId,
        shopName: `Shopee ${shopId}`,
        region: "VN",
        status: code ? "authorized" : "connected",
        connectedAt: new Date(),
        metadata: { authorizationCodeReceived: Boolean(code) },
      })
      .onConflictDoUpdate({
        target: [marketplaceShops.provider, marketplaceShops.shopId],
        set: {
          status: code ? "authorized" : "connected",
          connectedAt: new Date(),
          disconnectedAt: null,
          lastError: null,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: marketplaceShops.id });

    if (code && shopRow?.id) {
      try {
        const token = await exchangeShopeeAuthorizationCode({ code, shopId });
        const expiresAt = token.expireIn ? new Date(Date.now() + token.expireIn * 1000) : null;
        await db.insert(marketplaceTokens)
          .values({
            shopId: shopRow.id,
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            expiresAt,
            scopes: ["product", "order", "chat", "logistics"],
          })
          .onConflictDoUpdate({
            target: [marketplaceTokens.shopId],
            set: {
              accessToken: token.accessToken,
              refreshToken: token.refreshToken,
              expiresAt,
              scopes: ["product", "order", "chat", "logistics"],
              updatedAt: sql`now()`,
            },
          });
        await db.update(marketplaceShops).set({
          status: "connected",
          tokenExpiresAt: expiresAt,
          metadata: { authorizationCodeReceived: true, tokenExchange: "ok" },
          updatedAt: sql`now()`,
        }).where(eq(marketplaceShops.id, shopRow.id));
      } catch (tokenError) {
        await db.update(marketplaceShops).set({
          status: "authorized",
          lastError: tokenError instanceof Error ? tokenError.message : "token_exchange_failed",
          metadata: { authorizationCodeReceived: true, tokenExchange: "failed" },
          updatedAt: sql`now()`,
        }).where(eq(marketplaceShops.id, shopRow.id));
      }
    }
  } catch {
    const target = new URL(Routes.OnlineSales, url.origin);
    target.searchParams.set("tab", "channels");
    target.searchParams.set("error", "marketplace_migration_required");
    return NextResponse.redirect(target);
  }

  const [shop] = await db.select({ id: marketplaceShops.id }).from(marketplaceShops).where(eq(marketplaceShops.shopId, shopId)).limit(1);
  const target = new URL(Routes.OnlineSales, url.origin);
  if (shop?.id) target.searchParams.set("shop", shop.id);
  return NextResponse.redirect(target);
}
