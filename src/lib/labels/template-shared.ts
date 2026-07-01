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
