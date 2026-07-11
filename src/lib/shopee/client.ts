import { createHmac } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { marketplaceShops, marketplaceTokens } from "@/db/schema";
import { getShopeeSettings } from "@/lib/data/settings";

type ShopeeSettings = Awaited<ReturnType<typeof getShopeeSettings>>;

export type ShopeeApiCategory = {
  id: string;
  parentId: string;
  name: string;
  hasChildren: boolean;
};

export type ShopeeApiAttributeValue = {
  id: string;
  name: string;
};

export type ShopeeApiAttribute = {
  id: string;
  name: string;
  mandatory: boolean;
  inputType: string;
  values: ShopeeApiAttributeValue[];
};

export type ShopeeApiLogisticsChannel = {
  id: string;
  name: string;
  enabled: boolean;
};

type ShopeeTokenResponse = {
  accessToken: string;
  refreshToken: string;
  expireIn: number;
  raw: Record<string, unknown>;
};

type AuthorizedShop = {
  id: string;
  shopId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  metadata: Record<string, unknown> | null;
};

function shopeeBaseUrl(environment: ShopeeSettings["environment"]) {
  return environment === "production" ? "https://partner.shopeemobile.com" : "https://partner.test-stable.shopeemobile.com";
}

function partnerIdNumber(settings: ShopeeSettings) {
  const partnerId = Number(settings.partnerId);
  if (!Number.isSafeInteger(partnerId) || partnerId <= 0) throw new Error("invalid_shopee_partner_id");
  if (!settings.partnerKey) throw new Error("missing_shopee_partner_credentials");
  return partnerId;
}

function sign(settings: ShopeeSettings, path: string, timestamp: number, accessToken?: string, shopId?: string) {
  const partnerId = partnerIdNumber(settings);
  const base = accessToken && shopId
    ? `${partnerId}${path}${timestamp}${accessToken}${shopId}`
    : `${partnerId}${path}${timestamp}`;
  return createHmac("sha256", settings.partnerKey).update(base).digest("hex");
}

function commonParams(settings: ShopeeSettings, path: string, timestamp: number, accessToken?: string, shopId?: string) {
  const partnerId = partnerIdNumber(settings);
  const params = new URLSearchParams({
    partner_id: String(partnerId),
    timestamp: String(timestamp),
    sign: sign(settings, path, timestamp, accessToken, shopId),
  });
  if (accessToken && shopId) {
    params.set("access_token", accessToken);
    params.set("shop_id", shopId);
  }
  return params;
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: "invalid_json_response", message: text };
  }
}

function shopeeError(data: Record<string, unknown>) {
  const error = typeof data.error === "string" ? data.error : "";
  const message = typeof data.message === "string" ? data.message : "";
  return error || message ? `${error}${message ? `: ${message}` : ""}` : "";
}

async function shopeeFetch(settings: ShopeeSettings, path: string, params: URLSearchParams, init?: RequestInit) {
  const url = new URL(`${shopeeBaseUrl(settings.environment)}${path}`);
  params.forEach((value, key) => url.searchParams.set(key, value));
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await readJsonResponse(response);
  const apiError = shopeeError(data);
  if (!response.ok || apiError) throw new Error(apiError || `Shopee API ${response.status}`);
  return data;
}

async function getAuthorizedShop(shopUuid?: string): Promise<AuthorizedShop | null> {
  const rows = await db
    .select({
      id: marketplaceShops.id,
      shopId: marketplaceShops.shopId,
      accessToken: marketplaceTokens.accessToken,
      refreshToken: marketplaceTokens.refreshToken,
      expiresAt: marketplaceTokens.expiresAt,
      metadata: marketplaceShops.metadata,
    })
    .from(marketplaceShops)
    .leftJoin(marketplaceTokens, eq(marketplaceTokens.shopId, marketplaceShops.id))
    .where(eq(marketplaceShops.provider, "shopee"))
    .orderBy(sql`${marketplaceShops.updatedAt} desc`)
    .limit(20);

  const row = (shopUuid ? rows.find((item) => item.id === shopUuid) : rows.find((item) => item.accessToken)) ?? null;
  if (!row?.accessToken) return null;
  return {
    id: row.id,
    shopId: row.shopId,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: row.expiresAt,
    metadata: row.metadata,
  };
}

function isDemoShop(shop: AuthorizedShop) {
  return shop.accessToken.startsWith("demo-") || shop.metadata?.mode === "demo";
}

export async function exchangeShopeeAuthorizationCode(input: { code: string; shopId: string }): Promise<ShopeeTokenResponse> {
  const settings = await getShopeeSettings();
  const path = "/api/v2/auth/token/get";
  const timestamp = Math.floor(Date.now() / 1000);
  const params = commonParams(settings, path, timestamp);
  const partnerId = partnerIdNumber(settings);
  const data = await shopeeFetch(settings, path, params, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: input.code,
      partner_id: partnerId,
      shop_id: Number(input.shopId),
    }),
  });
  const accessToken = typeof data.access_token === "string" ? data.access_token : "";
  const refreshToken = typeof data.refresh_token === "string" ? data.refresh_token : "";
  const expireIn = Number(data.expire_in);
  if (!accessToken) throw new Error("missing_access_token");
  return {
    accessToken,
    refreshToken,
    expireIn: Number.isFinite(expireIn) && expireIn > 0 ? expireIn : 0,
    raw: data,
  };
}

async function getShopeeShopContext(shopUuid?: string) {
  const settings = await getShopeeSettings();
  const shop = await getAuthorizedShop(shopUuid);
  if (!shop) throw new Error("missing_shopee_shop_token");
  return { settings, shop };
}

async function getShopApi(path: string, requestParams: Record<string, string>, shopUuid?: string) {
  const { settings, shop } = await getShopeeShopContext(shopUuid);
  const timestamp = Math.floor(Date.now() / 1000);
  const params = commonParams(settings, path, timestamp, shop.accessToken, shop.shopId);
  Object.entries(requestParams).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return shopeeFetch(settings, path, params);
}

export async function getShopeeCategories(shopUuid?: string): Promise<ShopeeApiCategory[]> {
  const context = await getShopeeShopContext(shopUuid);
  if (isDemoShop(context.shop)) return DEMO_SHOPEE_CATEGORIES;
  const data = await getShopApi("/api/v2/product/get_category", { language: "vi" }, shopUuid);
  const response = data.response && typeof data.response === "object" ? data.response as Record<string, unknown> : data;
  const list = Array.isArray(response.category_list) ? response.category_list : [];
  return list.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const displayName = row.display_category_name ?? row.category_name ?? row.original_category_name;
    return {
      id: String(row.category_id ?? ""),
      parentId: String(row.parent_category_id ?? "0"),
      name: String(displayName ?? ""),
      hasChildren: Boolean(row.has_children),
    };
  }).filter((category) => category.id && category.name);
}

export async function getShopeeAttributes(categoryId: string, shopUuid?: string): Promise<ShopeeApiAttribute[]> {
  const context = await getShopeeShopContext(shopUuid);
  if (isDemoShop(context.shop)) return DEMO_SHOPEE_ATTRIBUTES[categoryId] ?? DEMO_SHOPEE_ATTRIBUTES.default;
  const data = await getShopApi("/api/v2/product/get_attribute_tree", { category_id: categoryId, language: "vi" }, shopUuid);
  const response = data.response && typeof data.response === "object" ? data.response as Record<string, unknown> : data;
  const list = Array.isArray(response.attribute_list) ? response.attribute_list : [];
  return list.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const displayName = row.display_attribute_name ?? row.attribute_name ?? row.original_attribute_name;
    const values = Array.isArray(row.attribute_value_list) ? row.attribute_value_list : [];
    return {
      id: String(row.attribute_id ?? ""),
      name: String(displayName ?? ""),
      mandatory: Boolean(row.is_mandatory),
      inputType: String(row.input_type ?? ""),
      values: values.map((value) => {
        const valueRow = value && typeof value === "object" ? value as Record<string, unknown> : {};
        const valueName = valueRow.display_value_name ?? valueRow.value_name ?? valueRow.original_value_name;
        return { id: String(valueRow.value_id ?? ""), name: String(valueName ?? "") };
      }).filter((value) => value.id && value.name),
    };
  }).filter((attribute) => attribute.id && attribute.name);
}

export async function getShopeeLogisticsChannels(shopUuid?: string): Promise<ShopeeApiLogisticsChannel[]> {
  const context = await getShopeeShopContext(shopUuid);
  if (isDemoShop(context.shop)) return DEMO_SHOPEE_LOGISTICS;
  const data = await getShopApi("/api/v2/logistics/get_channel_list", {}, shopUuid);
  const response = data.response && typeof data.response === "object" ? data.response as Record<string, unknown> : data;
  const list = Array.isArray(response.logistics_channel_list) ? response.logistics_channel_list : [];
  return list.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      id: String(row.logistics_channel_id ?? ""),
      name: String(row.logistics_channel_name ?? ""),
      enabled: row.enabled === undefined ? true : Boolean(row.enabled),
    };
  }).filter((channel) => channel.id && channel.name);
}

const DEMO_SHOPEE_CATEGORIES: ShopeeApiCategory[] = [
  { id: "100016", parentId: "0", name: "Nhà Cửa & Đời Sống", hasChildren: true },
  { id: "10001601", parentId: "100016", name: "Vật liệu xây dựng", hasChildren: true },
  { id: "1000160101", parentId: "10001601", name: "Gạch ốp lát", hasChildren: false },
  { id: "1000160102", parentId: "10001601", name: "Ống nước & phụ kiện", hasChildren: false },
  { id: "100010", parentId: "0", name: "Thiết Bị Điện Gia Dụng", hasChildren: true },
  { id: "10001001", parentId: "100010", name: "Thiết bị điện", hasChildren: true },
  { id: "1000100101", parentId: "10001001", name: "Át cài / CB điện", hasChildren: false },
  { id: "1000100102", parentId: "10001001", name: "Ổ cắm & công tắc", hasChildren: false },
  { id: "100636", parentId: "0", name: "Thiết Bị Vệ Sinh", hasChildren: true },
  { id: "10063601", parentId: "100636", name: "Vòi sen & phụ kiện", hasChildren: false },
  { id: "10063602", parentId: "100636", name: "Bồn cầu", hasChildren: false },
];

const DEMO_SHOPEE_ATTRIBUTES: Record<string, ShopeeApiAttribute[]> = {
  default: [
    { id: "brand", name: "Thương hiệu", mandatory: true, inputType: "TEXT_FILED", values: [] },
    { id: "material", name: "Chất liệu", mandatory: true, inputType: "COMBO_BOX", values: [{ id: "ceramic", name: "Ceramic" }, { id: "pvc", name: "PVC" }, { id: "steel", name: "Thép" }] },
    { id: "warranty", name: "Bảo hành", mandatory: true, inputType: "COMBO_BOX", values: [{ id: "none", name: "Không bảo hành" }, { id: "12m", name: "12 tháng" }, { id: "24m", name: "24 tháng" }] },
  ],
  "1000100101": [
    { id: "brand", name: "Thương hiệu", mandatory: true, inputType: "TEXT_FILED", values: [] },
    { id: "rated_current", name: "Dòng điện định mức", mandatory: true, inputType: "COMBO_BOX", values: [{ id: "20a", name: "20A" }, { id: "32a", name: "32A" }, { id: "63a", name: "63A" }] },
    { id: "poles", name: "Số pha / số cực", mandatory: true, inputType: "COMBO_BOX", values: [{ id: "1p", name: "1P" }, { id: "2p", name: "2P" }, { id: "3p", name: "3P" }] },
  ],
};

const DEMO_SHOPEE_LOGISTICS: ShopeeApiLogisticsChannel[] = [
  { id: "5001", name: "Shopee Xpress", enabled: true },
  { id: "5002", name: "Giao Hàng Nhanh", enabled: true },
  { id: "5003", name: "Viettel Post", enabled: true },
];
