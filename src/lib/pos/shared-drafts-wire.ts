import type { PosProduct } from "@/lib/data/pos";

export type SharedPosDraftRecord = {
  id: string;
  payload: Record<string, unknown>;
  updatedAt: string;
  deleted: boolean;
};

function object(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sharedProduct(rawValue: unknown): PosProduct {
  const raw = object(rawValue);
  const units = Array.isArray(raw.units) ? raw.units.map((entry) => {
    const unit = object(entry);
    return {
      unitName: text(unit.unitName) ?? "",
      multiplier: String(number(unit.multiplier, 1)),
      sku: text(unit.sku) ?? null,
      barcode: text(unit.barcode) ?? null,
      priceOverride: unit.priceOverride == null ? null : String(number(unit.priceOverride)),
      directSale: unit.directSale !== false,
    };
  }) : [];
  const children = Array.isArray(raw.children) ? raw.children.map(sharedProduct) : [];
  const prices = Object.fromEntries(Object.entries(object(raw.prices)).map(([key, value]) => [
    key,
    value == null ? null : String(number(value)),
  ]));
  const imageUrls = Array.isArray(raw.imageUrls)
    ? raw.imageUrls.filter((value): value is string => typeof value === "string")
    : [];

  return {
    ...raw,
    id: text(raw.id) ?? "",
    sku: text(raw.sku) ?? "",
    barcode: text(raw.barcode) ?? null,
    name: text(raw.name) ?? "",
    productKind: text(raw.productKind) ?? "product",
    imageUrls,
    imageUpdatedAt: null,
    specs: object(raw.specs),
    parentProductId: text(raw.parentProductId) ?? null,
    variantName: text(raw.variantName) ?? null,
    isVariantParent: raw.isVariantParent === true || children.length > 0,
    baseUnit: text(raw.baseUnit) ?? "",
    baseUnitDirectSale: raw.baseUnitDirectSale !== false,
    costPrice: raw.costPrice == null ? null : String(number(raw.costPrice)),
    lastPurchasePrice: raw.lastPurchasePrice == null ? null : String(number(raw.lastPurchasePrice)),
    lastPurchaseNetPrice: raw.lastPurchaseNetPrice == null ? null : String(number(raw.lastPurchaseNetPrice)),
    retailPrice: raw.retailPrice == null ? "0" : String(number(raw.retailPrice)),
    wholesalePrice: raw.wholesalePrice == null ? "0" : String(number(raw.wholesalePrice)),
    contractorPrice: raw.contractorPrice == null ? "0" : String(number(raw.contractorPrice)),
    agentPrice: raw.agentPrice == null ? "0" : String(number(raw.agentPrice)),
    priceByWeight: raw.priceByWeight === true,
    m2PerUnit: raw.m2PerUnit == null ? null : String(number(raw.m2PerUnit)),
    categoryId: text(raw.categoryId) ?? null,
    categoryName: text(raw.categoryName) ?? null,
    vatRate: raw.vatRate == null ? null : String(number(raw.vatRate)),
    lastSoldAt: text(raw.lastSoldAt) ?? null,
    comboItems: Array.isArray(raw.comboItems) ? raw.comboItems : [],
    childCount: number(raw.childCount, children.length),
    minRetailPrice: raw.minRetailPrice == null ? "0" : String(number(raw.minRetailPrice)),
    maxRetailPrice: raw.maxRetailPrice == null ? "0" : String(number(raw.maxRetailPrice)),
    stock: String(number(raw.stock)),
    booked: String(number(raw.booked)),
    units,
    prices,
    children,
    priceBookTypes: object(raw.priceBookTypes),
  } as unknown as PosProduct;
}

export function sharedPosRecordToDraft(record: SharedPosDraftRecord): Record<string, unknown> | null {
  const tab = record.payload;
  if (record.deleted || !Array.isArray(tab.lines)) return null;
  const cart = tab.lines.flatMap((rawLine) => {
    const line = object(rawLine);
    const productSnapshot = object(line.productSnapshot);
    if (!text(productSnapshot.id)) return [];
    const multiplier = number(line.unitMultiplier, 1) || 1;
    const basePrice = number(line.basePrice);
    const manualPriceValue = line.manualPrice == null ? null : number(line.manualPrice);
    const discountType = text(line.discountType)?.toLowerCase();
    const priceListOverride = text(line.priceListOverride);
    const lineMetadata = object(line.webMetadata);
    const freeRestore = object(lineMetadata.freeRestore);
    return [{
      key: text(line.id) ?? `${record.id}:${String(productSnapshot.id)}`,
      product: sharedProduct(productSnapshot),
      unitName: text(line.unitId) ?? text(productSnapshot.baseUnit) ?? "",
      unitMultiplier: multiplier,
      unitPrice: (manualPriceValue ?? basePrice) * multiplier,
      quantity: number(line.quantity, 1),
      lineDiscount: discountType === "đ" || discountType === "vnd" || discountType === "amount"
        ? number(line.discountValue)
        : 0,
      lineDiscountMode: discountType === "%" || discountType === "pct" || discountType === "percent"
        ? "pct"
        : "vnd",
      lineDiscountValue: number(line.discountValue),
      manualPrice: manualPriceValue != null,
      priceBook: priceListOverride ? priceListOverride === "retail" ? "" : priceListOverride : undefined,
      freeRestore: lineMetadata.freeRestore ? {
        unitPrice: number(freeRestore.unitPrice),
        lineDiscount: number(freeRestore.lineDiscount),
        lineDiscountMode: freeRestore.lineDiscountMode === "pct" ? "pct" : "vnd",
        lineDiscountValue: number(freeRestore.lineDiscountValue),
        priceBook: text(freeRestore.priceBook),
      } : undefined,
      note: text(line.note) ?? "",
    }];
  });
  const discountType = text(tab.orderDiscountType)?.toLowerCase();
  const metadata = object(tab.webMetadata);
  const kindValue = text(tab.webDraftKind) ?? text(metadata.webDraftKind) ?? text(tab.kind) ?? "invoice";
  const kind = kindValue === "quote" || kindValue === "booking"
    ? kindValue
    : kindValue === "returnQuick" || kindValue === "return_quick"
      ? "return_quick"
      : kindValue === "return_invoice"
        ? "return_invoice"
        : "invoice";
  const sourceOrderId = text(tab.sourceOrderId);
  const rawSourceMode = text(tab.sourceMode);
  const sourceMode = rawSourceMode === "returnOrder" ? "return" : rawSourceMode;
  const source = sourceOrderId && (sourceMode === "edit" || sourceMode === "copy" || sourceMode === "return")
    ? {
        id: sourceOrderId,
        mode: sourceMode,
        kind,
        code: text(tab.sourceCode) ?? "",
        customerId: text(tab.customerServerId) ?? "",
        projectId: text(tab.projectId) ?? "",
        projectName: text(tab.projectName) ?? "",
        note: text(tab.note) ?? "",
        discount: number(tab.orderDiscountValue),
        shippingFee: number(tab.shippingFee),
        tax: number(tab.taxRate),
        priceBookId: text(tab.priceList) === "retail" ? "" : text(tab.priceList) ?? "",
      }
    : undefined;

  return {
    ...metadata,
    id: record.id,
    kind,
    displayName: text(tab.displayName),
    cart,
    customerId: text(tab.customerServerId) ?? "",
    projectId: text(tab.projectId) ?? "",
    projectName: text(tab.projectName) ?? "",
    deliveryDate: text(tab.deliveryDate),
    priceBook: text(tab.priceList) === "retail" ? "" : text(tab.priceList) ?? "",
    discountInput: number(tab.orderDiscountValue),
    discountMode: discountType === "%" || discountType === "pct" || discountType === "percent" ? "pct" : "vnd",
    taxRate: number(tab.taxRate),
    shippingFee: number(tab.shippingFee),
    payMethod: text(metadata.payMethod) ?? "cash",
    paidInput: metadata.paidInput == null ? null : number(metadata.paidInput),
    note: text(tab.note),
    source,
    returnOrderId: sourceOrderId,
    returnOrderCode: text(tab.sourceCode),
    heldAt: tab.state === "parked" ? record.updatedAt : undefined,
    syncUpdatedAt: record.updatedAt,
  };
}

function sharedProductSnapshot(productValue: unknown): Record<string, unknown> {
  const product = object(productValue);
  const units = Array.isArray(product.units) ? product.units.map((value) => {
    const unit = object(value);
    return {
      unitName: unit.unitName,
      multiplier: number(unit.multiplier, 1),
      sku: unit.sku ?? null,
      barcode: unit.barcode ?? null,
      priceOverride: unit.priceOverride == null ? null : number(unit.priceOverride),
      directSale: unit.directSale !== false,
    };
  }) : [];
  return {
    id: product.id,
    name: product.name,
    enName: product.enName ?? null,
    sku: product.sku ?? "",
    barcode: product.barcode ?? null,
    parentProductId: product.parentProductId ?? null,
    variantName: product.variantName ?? null,
    specs: object(product.specs),
    isVariantParent: product.isVariantParent === true,
    children: Array.isArray(product.children) ? product.children.map(sharedProductSnapshot) : [],
    baseUnit: product.baseUnit ?? "",
    baseUnitDirectSale: product.baseUnitDirectSale !== false,
    categoryName: product.categoryName ?? null,
    retailPrice: product.retailPrice == null ? null : number(product.retailPrice),
    wholesalePrice: number(product.wholesalePrice),
    agentPrice: number(product.agentPrice ?? product.contractorPrice),
    prices: Object.fromEntries(Object.entries(object(product.prices)).map(([key, value]) => [key, value == null ? null : number(value)])),
    priceBookTypes: object(product.priceBookTypes),
    noFallbackPriceBookIds: [],
    stock: number(product.stock),
    booked: number(product.booked),
    productKind: product.productKind ?? "product",
    priceByWeight: product.priceByWeight === true,
    vatRate: product.vatRate == null ? null : number(product.vatRate),
    minRetailPrice: product.minRetailPrice == null ? null : number(product.minRetailPrice),
    maxRetailPrice: product.maxRetailPrice == null ? null : number(product.maxRetailPrice),
    imageUrls: Array.isArray(product.imageUrls) ? product.imageUrls : [],
    units,
  };
}

export function webDraftToSharedPayload(
  draftValue: object,
  index: number,
  customers: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const draft = draftValue as Record<string, unknown>;
  const customerId = text(draft.customerId);
  const customer = customerId
    ? customers.find((candidate) => candidate.id === customerId)
    : undefined;
  const discountMode = draft.discountMode === "pct" ? "%" : "đ";
  const source = object(draft.source);
  const kind = text(draft.kind) ?? "invoice";
  const tabLines = (Array.isArray(draft.cart) ? draft.cart : []).map((rawLine) => {
    const line = object(rawLine);
    const multiplier = number(line.unitMultiplier, 1) || 1;
    const discountMode = line.lineDiscountMode === "pct" ? "%" : "đ";
    return {
      id: text(line.key),
      productId: text(object(line.product).id),
      productSnapshot: sharedProductSnapshot(line.product),
      unitId: text(line.unitName),
      unitMultiplier: multiplier,
      quantity: number(line.quantity, 1),
      maxQuantity: line.returnSoldQuantity == null ? null : number(line.returnSoldQuantity),
      basePrice: number(line.unitPrice) / multiplier,
      manualPrice: line.manualPrice ? number(line.unitPrice) / multiplier : null,
      discountType: discountMode,
      discountValue: number(line.lineDiscountValue ?? line.lineDiscount),
      linePricingVersion: 2,
      priceBookType: null,
      promotionTiers: [],
      priceListOverride: line.priceBook === undefined
        ? null
        : text(line.priceBook) || "retail",
      webMetadata: line.freeRestore ? { freeRestore: object(line.freeRestore) } : {},
      note: text(line.note) ?? null,
    };
  });
  const metadata = {
    webDraftKind: text(draft.kind) ?? "invoice",
    payMethod: text(draft.payMethod) ?? "cash",
    paidInput: draft.paidInput == null ? null : number(draft.paidInput),
    cameraQuote: draft.cameraQuote === true,
    cameraInitialId: text(draft.cameraInitialId) ?? null,
    cameraPackages: Array.isArray(draft.cameraPackages) ? draft.cameraPackages : [],
    returnOrderId: text(draft.returnOrderId) ?? null,
    returnOrderCode: text(draft.returnOrderCode) ?? null,
  };
  return {
    id: text(draft.id) ?? `shared-${index + 1}`,
    number: index + 1,
    kind: kind === "invoice" ? "invoice" : kind === "return_invoice" ? "returnQuick" : kind,
    webDraftKind: kind,
    customerId: customer ? 1 : 0,
    customerServerId: customerId ?? null,
    customerSnapshot: customer ? {
      id: 1,
      serverId: customerId,
      name: customer.name,
      phone: customer.phone ?? null,
      tier: customer.type ?? "regular",
      priceList: customer.type ?? "retail",
      credit: number(customer.currentDebt),
    } : null,
    priceList: text(draft.priceBook) || "retail",
    orderDiscountType: discountMode,
    orderDiscountValue: number(draft.discountInput),
    vatOn: number(draft.taxRate) > 0,
    taxRate: number(draft.taxRate),
    priceIncludesTax: false,
    shippingFee: number(draft.shippingFee),
    state: text(draft.heldAt) ? "parked" : kind === "quote" ? "quotation" : "active",
    sourceOrderId: text(source.id) ?? text(draft.returnOrderId) ?? null,
    sourceMode: text(source.mode) === "return" ? "returnOrder" : text(source.mode) ?? null,
    sourceCode: text(source.code) ?? text(draft.returnOrderCode) ?? null,
    sourceStockByProduct: {},
    projectId: text(draft.projectId) ?? null,
    projectName: text(draft.projectName) ?? null,
    deliveryAddress: null,
    deliveryDate: text(draft.deliveryDate) ?? null,
    note: text(draft.note) ?? null,
    displayName: text(draft.displayName) ?? null,
    lines: tabLines,
    webMetadata: metadata,
  };
}
