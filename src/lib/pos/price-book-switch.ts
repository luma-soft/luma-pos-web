import { resolvePosUnitPrice } from "./price-book-price";
import { resolvePosCartUnit } from "./cart-unit";
import { createLinePriceEditorState, resolveLinePriceEditor, type LineDiscountMode, type LinePriceEditorState } from "./line-price-editor";

type PriceProduct = Parameters<typeof resolvePosUnitPrice>[0] & {
  baseUnit: string;
  units: { unitName: string; multiplier: string; priceOverride: string | null }[];
};
type Books = Parameters<typeof resolvePosUnitPrice>[3];

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
export function resolveSelectedPosUnitPrice(product: PriceProduct, unitName: string, bookId = "", books?: Books) {
  const unit = resolvePosCartUnit(product.baseUnit, product.units, unitName);
  return resolvePosUnitPrice(product, unit.alternateUnit, bookId, books);
}

export function selectedPosUnitPrice(product: PriceProduct, unitName: string, bookId = "", books?: Books) {
  return resolveSelectedPosUnitPrice(product, unitName, bookId, books)?.price ?? null;
}

/** Prepare the whole invoice before repricing; missing sale prices use the common price per line. */
export function prepareInvoicePriceBookSwitch<T extends PriceBookSwitchLine>(cart: readonly T[], bookId: string, books?: Books) {
  const prices = cart.map((line) => resolveSelectedPosUnitPrice(line.product, line.unitName, bookId, books));
  if (prices.some((selection) => selection == null || !Number.isFinite(selection.price))) return null;
  let changedPriceCount = 0;
  let clearedDiscountCount = 0;
  let preservedManualCount = 0;
  const lines = cart.map((line, index): T => {
    const selection = prices[index]!;
    const listedPrice = selection.price;
    const linePriceBook = selection.priceBookId === bookId ? undefined : selection.priceBookId;
    if (line.manualPrice) {
      preservedManualCount += 1;
      return {
        ...line,
        priceBook: linePriceBook,
        freeRestore: line.freeRestore
          ? { unitPrice: listedPrice, lineDiscount: 0, priceBook: linePriceBook }
          : undefined,
      };
    }
    if (line.unitPrice !== listedPrice) changedPriceCount += 1;
    if ((line.lineDiscount ?? 0) > 0 || (line.lineDiscountValue ?? 0) > 0) clearedDiscountCount += 1;
    return {
      ...line,
      priceBook: linePriceBook,
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
  const selection = resolveSelectedPosUnitPrice(line.product, line.unitName, bookId, books);
  if (!selection || !Number.isFinite(selection.price)) return null;
  const previous = resolveLinePriceEditor(current);
  return {
    editor: createLinePriceEditorState(selection.price, 0),
    previous,
    nextPrice: selection.price,
    priceBookId: selection.priceBookId,
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
