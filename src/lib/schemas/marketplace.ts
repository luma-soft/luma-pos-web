import { z } from "zod";

export const marketplaceProviderSchema = z.literal("shopee");

export const shopeeListingDraftSchema = z.object({
  productId: z.string().uuid(),
  mappingId: z.string().uuid().optional(),
  shopId: z.string().uuid().optional(),
  action: z.enum(["draft", "publish", "update"]).default("draft"),
  region: z.string().trim().max(10).default("VN"),
  warehouseId: z.string().trim().max(80).optional(),
  categoryId: z.string().trim().max(80).default(""),
  categoryPath: z.string().trim().max(300).default(""),
  brand: z.string().trim().max(120).default(""),
  title: z.string().trim().min(1).max(120),
  shortDescription: z.string().trim().max(500).default(""),
  description: z.string().trim().min(20).max(5000),
  condition: z.enum(["NEW", "USED"]).default("NEW"),
  status: z.enum(["draft", "ready", "published", "unlisted"]).default("draft"),
  sku: z.string().trim().max(80).default(""),
  barcode: z.string().trim().max(80).default(""),
  price: z.number().min(0),
  compareAtPrice: z.number().min(0).optional(),
  stock: z.number().min(0),
  weight: z.number().min(0).optional(),
  dimensions: z.string().trim().max(120).default(""),
  logisticId: z.string().trim().max(80).default(""),
  imageUrls: z.array(z.string().trim().max(1000)).max(12).default([]),
  videoUrl: z.string().trim().max(1000).default(""),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).default({}),
  variants: z.array(z.object({
    name: z.string().trim().max(120),
    sku: z.string().trim().max(80).default(""),
    barcode: z.string().trim().max(80).default(""),
    price: z.number().min(0),
    stock: z.number().min(0),
    imageUrls: z.array(z.string().trim().max(1000)).max(12).default([]),
  })).default([]),
  syncMode: z.enum(["luma_to_shopee", "shopee_to_luma", "manual"]).default("luma_to_shopee"),
  minStockThreshold: z.number().min(0).default(0),
  outOfStockBehavior: z.enum(["keep_visible", "unlist", "set_zero"]).default("keep_visible"),
  aiSuggestionId: z.string().uuid().optional(),
  editedFields: z.array(z.string()).default([]),
});
export type ShopeeListingDraftInput = z.input<typeof shopeeListingDraftSchema>;

export const aiListingFillSchema = z.object({
  productId: z.string().uuid(),
  mappingId: z.string().uuid().optional(),
  preserve: z.record(z.string(), z.unknown()).default({}),
});
export type AiListingFillInput = z.input<typeof aiListingFillSchema>;

export const importShopeeOrderSchema = z.object({
  shopId: z.string().uuid().optional(),
  orderSn: z.string().trim().min(1).max(120),
  status: z.string().trim().max(80).default("READY_TO_SHIP"),
  buyerName: z.string().trim().max(200).default("Shopee customer"),
  buyerPhone: z.string().trim().max(30).default(""),
  deliveryAddress: z.string().trim().max(500).default(""),
  total: z.number().min(0).default(0),
  shippingFee: z.number().min(0).default(0),
  items: z.array(z.object({
    productId: z.string().uuid(),
    name: z.string().trim().max(300),
    sku: z.string().trim().max(80).default(""),
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
  })).min(1),
  rawPayload: z.record(z.string(), z.unknown()).default({}),
});
export type ImportShopeeOrderInput = z.input<typeof importShopeeOrderSchema>;

export const sendMarketplaceMessageSchema = z.object({
  threadId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});
export type SendMarketplaceMessageInput = z.input<typeof sendMarketplaceMessageSchema>;

export const marketplaceShopSyncPolicySchema = z.object({
  shopId: z.string().uuid(),
  warehouseId: z.string().uuid().optional().or(z.literal("")),
  syncStock: z.boolean().default(true),
  syncPrice: z.boolean().default(true),
  importOrders: z.boolean().default(true),
  syncMessages: z.boolean().default(false),
  autoCreateCustomer: z.boolean().default(true),
  stockBuffer: z.number().min(0).max(100000).default(0),
  minStockThreshold: z.number().min(0).max(100000).default(0),
  outOfStockBehavior: z.enum(["keep_visible", "unlist", "set_zero"]).default("keep_visible"),
});
export type MarketplaceShopSyncPolicyInput = z.input<typeof marketplaceShopSyncPolicySchema>;
