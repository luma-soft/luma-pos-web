export type LabelBarcodeType = "code128";

export interface LabelTemplate {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  columns: number;
  gapMm: number;
  barcodeType: LabelBarcodeType;
  showName: boolean;
  showSku: boolean;
  showPrice: boolean;
  showUnit: boolean;
  showBarcodeText: boolean;
  showStoreName: boolean;
  barcodeHeightMm: number;
  barcodeQuietMm: number;
  fontScale: number;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

export const DEFAULT_LABEL_TEMPLATE: LabelTemplate = {
  id: "default-label-roll-3-104x22",
  name: "Giấy cuộn 3 nhãn · 104x22mm",
  widthMm: 34,
  heightMm: 22,
  columns: 3,
  gapMm: 1,
  barcodeType: "code128",
  showName: true,
  showSku: true,
  showPrice: true,
  showUnit: false,
  showBarcodeText: true,
  showStoreName: false,
  barcodeHeightMm: 8,
  barcodeQuietMm: 1.5,
  fontScale: 0.85,
  isDefault: true,
  isActive: true,
  sortOrder: 0,
};

export const BUILT_IN_LABEL_TEMPLATES: LabelTemplate[] = [
  DEFAULT_LABEL_TEMPLATE,
  { ...DEFAULT_LABEL_TEMPLATE, id: "default-label-roll-2-72x22", name: "Giấy cuộn 2 nhãn · 72x22mm", widthMm: 35, heightMm: 22, columns: 2, gapMm: 2, barcodeHeightMm: 8, barcodeQuietMm: 1.5, fontScale: 0.9, isDefault: false, sortOrder: 10 },
  { ...DEFAULT_LABEL_TEMPLATE, id: "default-label-roll-2-74x22", name: "Giấy cuộn 2 nhãn · 74x22mm", widthMm: 36, heightMm: 22, columns: 2, gapMm: 2, barcodeHeightMm: 8, barcodeQuietMm: 1.5, fontScale: 0.9, isDefault: false, sortOrder: 20 },
  { ...DEFAULT_LABEL_TEMPLATE, id: "default-label-roll-1-50x30", name: "Giấy cuộn 1 nhãn · 50x30mm", widthMm: 50, heightMm: 30, columns: 1, gapMm: 2, barcodeHeightMm: 11, isDefault: false, sortOrder: 30 },
  { ...DEFAULT_LABEL_TEMPLATE, id: "default-label-tomy-103", name: "Tomy 103 · 12 nhãn", widthMm: 65, heightMm: 38, columns: 3, gapMm: 2, barcodeHeightMm: 13, fontScale: 1.05, isDefault: false, sortOrder: 40 },
  { ...DEFAULT_LABEL_TEMPLATE, id: "default-label-tomy-145", name: "Tomy 145 · 65 nhãn A4", widthMm: 38, heightMm: 21, columns: 5, gapMm: 2, barcodeHeightMm: 7, barcodeQuietMm: 1.5, fontScale: 0.8, isDefault: false, sortOrder: 50 },
  { ...DEFAULT_LABEL_TEMPLATE, id: "default-label-jewelry-75x10", name: "Tem hàng trang sức · 75x10mm", widthMm: 75, heightMm: 10, columns: 1, gapMm: 2, barcodeHeightMm: 6, barcodeQuietMm: 1, fontScale: 0.75, showName: false, showSku: false, showPrice: true, showBarcodeText: false, isDefault: false, sortOrder: 60 },
];
