// Phần dùng chung cho cả server và client (KHÔNG import db) — để PrintDoc dùng được ở client.

export type PrintDocType = "order" | "quote" | "booking" | "purchase" | "return" | "receipt";
export type PaperSize = "a4" | "a5" | "k80";

export const PRINT_DOC_TYPES = ["order", "quote", "booking", "purchase", "return", "receipt"] as const satisfies readonly PrintDocType[];
export const PAPER_SIZES = ["a4", "a5", "k80"] as const satisfies readonly PaperSize[];

export interface PrintTemplateOptions {
  showSeller: boolean;
  showProject: boolean;
  showDebt: boolean;
  showDiscount: boolean;
  showTax: boolean;
  showLineDiscount: boolean;
  showPaymentQr: boolean;
  showInWords: boolean;
  showSignatures: boolean;
  showSku: boolean;
}

export interface PrintTemplate {
  id: string;
  name: string;
  docType: PrintDocType;
  paperDefault: PaperSize;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  storeName: string;
  storeAddress: string;
  storePhone: string;
  storeTaxCode: string;
  footerNote: string;
  options: PrintTemplateOptions;
}

export type PrintTemplateStoreInfo = Pick<PrintTemplate, "storeName" | "storeAddress" | "storePhone" | "storeTaxCode">;

export const DEFAULT_OPTIONS: PrintTemplateOptions = {
  showSeller: true,
  showProject: true,
  showDebt: true,
  showDiscount: true,
  showTax: true,
  showLineDiscount: true,
  showPaymentQr: true,
  showInWords: true,
  showSignatures: true,
  showSku: false,
};

export const DEFAULT_FOOTER: Record<PrintDocType, string> = {
  order: "Vui lòng kiểm tra hàng khi nhận. Hàng nguyên kiện chưa khui được đổi/trả trong 7 ngày.",
  quote: "Báo giá có hiệu lực trong 7 ngày. Giá chưa gồm vận chuyển nếu không ghi rõ.",
  booking: "Phiếu đặt hàng chưa phải hóa đơn bán hàng. Vui lòng xác nhận lại thời gian giao trước khi xuất kho.",
  purchase: "Đề nghị NCC giao đúng chủng loại, quy cách. Hàng hư hỏng vỡ bể sẽ trả lại.",
  return: "Biên nhận trả hàng — kèm theo hóa đơn gốc.",
  receipt: "",
};

export function defaultTemplate(docType: PrintDocType, storeInfo: Partial<PrintTemplateStoreInfo> = {}): PrintTemplate {
  return {
    id: `default-${docType}`,
    name: DEFAULT_TEMPLATE_NAME[docType],
    docType,
    paperDefault: docType === "quote" || docType === "booking" || docType === "purchase" ? "a4" : "a5",
    isDefault: true,
    isActive: true,
    sortOrder: 0,
    storeName: storeInfo.storeName ?? "",
    storeAddress: storeInfo.storeAddress ?? "",
    storePhone: storeInfo.storePhone ?? "",
    storeTaxCode: storeInfo.storeTaxCode ?? "",
    footerNote: DEFAULT_FOOTER[docType],
    options: { ...DEFAULT_OPTIONS },
  };
}

export const DEFAULT_TEMPLATE_NAME: Record<PrintDocType, string> = {
  order: "Mẫu hóa đơn mặc định",
  quote: "Mẫu báo giá mặc định",
  booking: "Mẫu đặt hàng mặc định",
  purchase: "Mẫu nhập hàng mặc định",
  return: "Mẫu trả hàng mặc định",
  receipt: "Mẫu biên nhận mặc định",
};

export function isPersistedTemplateId(id: string | null | undefined) {
  return Boolean(id && !id.startsWith("default-"));
}

/** Đọc số tiền thành chữ tiếng Việt. */
export function moneyToWords(n: number): string {
  if (n === 0) return "Không đồng";
  const digits = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
  const scales = ["", " nghìn", " triệu", " tỷ"];
  function threeDigits(num: number, full: boolean): string {
    const tr = Math.floor(num / 100), ch = Math.floor((num % 100) / 10), dv = num % 10;
    let s = "";
    if (tr > 0 || full) s += `${digits[tr]} trăm`;
    if (ch > 1) {
      s += ` ${digits[ch]} mươi`;
      if (dv === 1) s += " mốt";
      else if (dv === 5) s += " lăm";
      else if (dv > 0) s += ` ${digits[dv]}`;
    } else if (ch === 1) {
      s += " mười";
      if (dv === 5) s += " lăm";
      else if (dv > 0) s += ` ${digits[dv]}`;
    } else if (dv > 0) {
      if (s) s += " lẻ";
      s += ` ${digits[dv]}`;
    }
    return s.trim();
  }
  const groups: number[] = [];
  let v = Math.round(Math.abs(n));
  while (v > 0) { groups.push(v % 1000); v = Math.floor(v / 1000); }
  let out = "";
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] > 0) out += `${threeDigits(groups[i], i !== groups.length - 1 && out !== "")}${scales[i]} `;
  }
  out = out.trim() + " đồng";
  return out.charAt(0).toUpperCase() + out.slice(1);
}
