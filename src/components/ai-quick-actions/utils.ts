import type { AiActionLine, AiActionPreview } from "@/lib/ai/actions";
import type { AiQuickActionPreset } from "./types";

export function quickActionPrompt(input: {
  preset: AiQuickActionPreset;
  userText: string;
  attachmentCount: number;
  attachmentNames: string[];
}) {
  const userText = input.userText.trim();
  const fallback =
    input.preset === "create_inventory_inbound"
      ? "Đọc file/ảnh đính kèm và tạo preview phiếu nhập hàng."
      : "Tạo giỏ POS nháp từ nội dung hoặc file/ảnh đính kèm.";
  const instruction =
    input.preset === "create_inventory_inbound"
      ? "Tạo phiếu nhập hàng từ thông tin sau. Chỉ tạo preview/draft để user áp dụng vào form hiện tại; không lưu, không cộng tồn kho, không ghi thanh toán."
      : "Tạo giỏ POS nháp từ thông tin sau. Chỉ trả về cart draft để user thêm vào giỏ hiện tại; không tạo hóa đơn, không thanh toán, không trừ kho.";
  const prompt = `[AI_ACTION_PRESET:${input.preset}]\n${instruction}\n\nThông tin người dùng:\n\n${userText || fallback}`;
  return input.attachmentCount
    ? `${prompt}\n\n[${input.attachmentCount} attachment(s): ${input.attachmentNames.join(", ")}]`
    : prompt;
}

export function previewMatchedCount(preview: AiActionPreview) {
  const items = Array.isArray(preview.action.payload.items) ? preview.action.payload.items : [];
  return items.length;
}

export function previewUnresolvedCount(preview: AiActionPreview) {
  const items = Array.isArray(preview.action.payload.unresolvedItems) ? preview.action.payload.unresolvedItems : [];
  return items.length;
}

export function fieldValue(fields: AiActionLine[], labelIncludes: string) {
  const needle = labelIncludes.toLowerCase();
  return fields.find((field) => field.label.toLowerCase().includes(needle))?.value ?? "—";
}

export function isPreviewApplicable(preview: AiActionPreview, acceptedIntents: string[]) {
  return acceptedIntents.includes(preview.intent) && previewMatchedCount(preview) > 0;
}
