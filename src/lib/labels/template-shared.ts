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
  id: "default-label-40x30",
  name: "Tem 40x30mm",
  widthMm: 40,
  heightMm: 30,
  columns: 3,
  gapMm: 2,
  barcodeType: "code128",
  showName: true,
  showSku: true,
  showPrice: true,
  showUnit: false,
  showBarcodeText: true,
  showStoreName: false,
  barcodeHeightMm: 10,
  barcodeQuietMm: 2,
  fontScale: 1,
  isDefault: true,
  isActive: true,
  sortOrder: 0,
};

export const BUILT_IN_LABEL_TEMPLATES: LabelTemplate[] = [
  DEFAULT_LABEL_TEMPLATE,
  { ...DEFAULT_LABEL_TEMPLATE, id: "default-label-40x20", name: "Tem 40x20mm", widthMm: 40, heightMm: 20, columns: 3, barcodeHeightMm: 7, fontScale: 0.82, isDefault: false, sortOrder: 10 },
  { ...DEFAULT_LABEL_TEMPLATE, id: "default-label-50x25", name: "Tem 50x25mm", widthMm: 50, heightMm: 25, columns: 2, gapMm: 3, barcodeHeightMm: 8, fontScale: 0.9, isDefault: false, sortOrder: 20 },
  { ...DEFAULT_LABEL_TEMPLATE, id: "default-label-50x30", name: "Tem 50x30mm", widthMm: 50, heightMm: 30, columns: 2, gapMm: 3, barcodeHeightMm: 11, isDefault: false, sortOrder: 30 },
  { ...DEFAULT_LABEL_TEMPLATE, id: "default-label-35x22", name: "Tem nhỏ 35x22mm", widthMm: 35, heightMm: 22, columns: 4, barcodeHeightMm: 8, barcodeQuietMm: 1.5, fontScale: 0.9, isDefault: false, sortOrder: 40 },
  { ...DEFAULT_LABEL_TEMPLATE, id: "default-label-60x40", name: "Tem 60x40mm", widthMm: 60, heightMm: 40, columns: 2, gapMm: 3, barcodeHeightMm: 14, fontScale: 1.1, isDefault: false, sortOrder: 50 },
  { ...DEFAULT_LABEL_TEMPLATE, id: "default-label-100x50", name: "Tem 100x50mm", widthMm: 100, heightMm: 50, columns: 1, gapMm: 3, barcodeHeightMm: 18, fontScale: 1.2, isDefault: false, sortOrder: 60 },
];
