import type { AiPlannerIntent } from "@/lib/ai/planner";

export type AiEvaluationCase = {
  id: string;
  prompt: string;
  expectedIntent: AiPlannerIntent;
  expectedMissingFields: string[];
  expectedPreviewType: string;
  confirmation: "none" | "standard" | "strong";
  shouldFallback: boolean;
  tags: string[];
};

export const AI_EVALUATION_CASES: AiEvaluationCase[] = [
  {
    id: "clear-inbound",
    prompt: "Nhập 20 thùng cà phê Robusta vào kho chính từ NCC A",
    expectedIntent: "create_inventory_inbound",
    expectedMissingFields: [],
    expectedPreviewType: "inventory_inbound",
    confirmation: "standard",
    shouldFallback: false,
    tags: ["clear", "inventory"],
  },
  {
    id: "missing-fields-price",
    prompt: "Đặt giá bán lẻ cho sản phẩm này là 120.000",
    expectedIntent: "set_product_price",
    expectedMissingFields: ["product"],
    expectedPreviewType: "price_update",
    confirmation: "standard",
    shouldFallback: false,
    tags: ["missing-fields", "pricing"],
  },
  {
    id: "ambiguous-product",
    prompt: "Nhập 10 bao xi măng vào kho chính",
    expectedIntent: "create_inventory_inbound",
    expectedMissingFields: [],
    expectedPreviewType: "inventory_inbound",
    confirmation: "standard",
    shouldFallback: false,
    tags: ["ambiguous-product", "inventory"],
  },
  {
    id: "typo-no-accent",
    prompt: "tao po nhap cac sku sap het hang",
    expectedIntent: "create_draft_purchase_order_from_restocking",
    expectedMissingFields: [],
    expectedPreviewType: "draft_purchase_order",
    confirmation: "standard",
    shouldFallback: false,
    tags: ["typo", "no-accents", "restocking"],
  },
  {
    id: "mixed-language-pos",
    prompt: "POS cart: 2 ca phe sua, 1 banh mi thit",
    expectedIntent: "pos_voice_cart_draft",
    expectedMissingFields: [],
    expectedPreviewType: "pos_cart_draft",
    confirmation: "standard",
    shouldFallback: false,
    tags: ["mixed-language", "pos-voice"],
  },
  {
    id: "ocr-text",
    prompt: "Tạo giỏ POS từ ảnh\n[AI attachment parse]\nCandidates:\n- 2 Cà phê sữa | confidence=91%",
    expectedIntent: "pos_image_cart_draft",
    expectedMissingFields: [],
    expectedPreviewType: "pos_cart_draft",
    confirmation: "standard",
    shouldFallback: false,
    tags: ["ocr", "pos-image"],
  },
  {
    id: "dangerous-bulk-price",
    prompt: "Tăng toàn bộ bảng giá bán lẻ 15%",
    expectedIntent: "apply_price_formula",
    expectedMissingFields: [],
    expectedPreviewType: "price_formula",
    confirmation: "strong",
    shouldFallback: false,
    tags: ["dangerous", "bulk", "pricing"],
  },
  {
    id: "unsupported-request",
    prompt: "Viết bài quảng cáo Facebook cho cửa hàng",
    expectedIntent: "unknown",
    expectedMissingFields: [],
    expectedPreviewType: "none",
    confirmation: "none",
    shouldFallback: true,
    tags: ["unsupported"],
  },
];
