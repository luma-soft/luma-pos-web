import { posUnitPrice } from "./price-book-price";
import { resolvePosCartUnit } from "./cart-unit";
import { createLinePriceEditorState, resolveLinePriceEditor, type LineDiscountMode, type LinePriceEditorState } from "./line-price-editor";

type PriceProduct = Parameters<typeof posUnitPrice>[0] & {
  baseUnit: string;
  units: { unitName: string; multiplier: string; priceOverride: string | null }[];
};
type Books = Parameters<typeof posUnitPrice>[3];

export type PriceBookSwitchLine = {
  product: PriceProduct;
  unitName: string;
  unitPrice: number;
  lineDiscount?: number;
  lineDiscountMode?: LineDiscountMode;
  lineDiscountValue?: number;
  manualPrice?: boolean;
  priceBook?: string;
  freeRestore?: { unitPrice: number; lineDiscount: number; lineDiscountMode?: LineDiscountMode; lineDiscountValue?: number; priceBook?: string };
};

/** The selected base unit must retain its decimal price even if the catalog has a redundant base row. */
export function selectedPosUnitPrice(product: PriceProduct, unitName: string, bookId = "", books?: Books) {
  const unit = resolvePosCartUnit(product.baseUnit, product.units, unitName);
  return posUnitPrice(product, unit.alternateUnit, bookId, books);
}

/** Prepare the whole invoice first: a missing source must not partially reprice its cart. */
export function prepareInvoicePriceBookSwitch<T extends PriceBookSwitchLine>(cart: readonly T[], bookId: string, books?: Books) {
  const prices = cart.map((line) => selectedPosUnitPrice(line.product, line.unitName, bookId, books));
  if (prices.some((price) => price == null || !Number.isFinite(price))) return null;
  let changedPriceCount = 0;
  let clearedDiscountCount = 0;
  let preservedManualCount = 0;
  const lines = cart.map((line, index): T => {
    const listedPrice = prices[index]!;
    if (line.manualPrice) {
      preservedManualCount += 1;
      return {
        ...line,
        priceBook: undefined,
        freeRestore: line.freeRestore
          ? { unitPrice: listedPrice, lineDiscount: 0, priceBook: undefined }
          : undefined,
      };
    }
    if (line.unitPrice !== listedPrice) changedPriceCount += 1;
    if ((line.lineDiscount ?? 0) > 0 || (line.lineDiscountValue ?? 0) > 0) clearedDiscountCount += 1;
    return {
      ...line,
      priceBook: undefined,
      unitPrice: listedPrice,
      lineDiscount: 0,
      lineDiscountMode: "vnd",
      lineDiscountValue: 0,
      freeRestore: undefined,
    };
  });
  return { lines, changedPriceCount, clearedDiscountCount, preservedManualCount };
}

/** Selecting a book on one line intentionally resets that line's price and discount. */
export function prepareLinePriceBookSwitch(line: Pick<PriceBookSwitchLine, "product" | "unitName">, bookId: string, current: LinePriceEditorState, books?: Books) {
  const price = selectedPosUnitPrice(line.product, line.unitName, bookId, books);
  if (price == null || !Number.isFinite(price)) return null;
  const previous = resolveLinePriceEditor(current);
  return {
    editor: createLinePriceEditorState(price, 0),
    previous,
    nextPrice: price,
  };
}

/** No mutation before approval; a cart/editor that changed while waiting needs a fresh review. */
export async function approvePriceBookSwitch<T>(options: {
  value: T;
  needsConfirmation: boolean;
  confirm: () => Promise<boolean>;
  isCurrent: () => boolean;
  commit: (value: T) => void;
}) {
  if (options.needsConfirmation && !await options.confirm()) return "cancelled" as const;
  if (!options.isCurrent()) return "stale" as const;
  options.commit(options.value);
  return "applied" as const;
}
