import { createHash } from "node:crypto";
import type { TableCartItem } from "@/lib/schemas/table";

export type AuthoritativeTableProduct = {
  id: string;
  name: string;
  baseUnit: string;
  retailPrice: string | number;
  isActive: boolean;
  lifecycleStatus?: string | null;
  categoryId?: string | null;
};

export type AuthoritativeModifierOption = {
  label: string;
  priceDelta: number;
  categoryIds?: string[];
};

function normalizedLabel(value: string) {
  return value.trim().toLocaleLowerCase("vi");
}

export function tableCheckoutClientId(input: {
  tableId: string;
  lineIds: string[];
}) {
  const identity = `${input.tableId}:${[...input.lineIds].sort().join(":")}`;
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 32);
  return `fb:${digest}`;
}

function assertUniqueLineIds(items: TableCartItem[]) {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.lineId)) throw new Error("DUPLICATE_LINE_ID");
    ids.add(item.lineId);
  }
}

/** Preserve kitchen-submitted lines even when an untrusted client omits or edits them. */
export function mergeLockedTableCart(input: {
  existing: TableCartItem[];
  requested: TableCartItem[];
}) {
  assertUniqueLineIds(input.existing);
  assertUniqueLineIds(input.requested);
  const lockedLines = input.existing.filter((item) => item.sent);
  const lockedSentLineIds = new Set(lockedLines.map((item) => item.lineId));
  const editableLines = input.requested.filter(
    (item) => !lockedSentLineIds.has(item.lineId),
  );
  return {
    items: [...lockedLines, ...editableLines],
    lockedSentLineIds,
  };
}

/**
 * Rebuild an F&B cart from server-owned product and modifier records.
 *
 * Client product names, units, prices, modifier deltas and `sent` flags are
 * display hints only. A sent flag is accepted exclusively for line ids already
 * locked by the server after kitchen submission.
 */
export function resolveAuthoritativeTableCart(input: {
  items: TableCartItem[];
  products: AuthoritativeTableProduct[];
  modifierOptions: AuthoritativeModifierOption[];
  lockedSentLineIds: ReadonlySet<string>;
}): TableCartItem[] {
  assertUniqueLineIds(input.items);
  const productById = new Map(input.products.map((product) => [product.id, product]));
  const optionsByLabel = new Map<string, AuthoritativeModifierOption[]>();
  for (const option of input.modifierOptions) {
    const key = normalizedLabel(option.label);
    const options = optionsByLabel.get(key) ?? [];
    options.push(option);
    optionsByLabel.set(key, options);
  }

  return input.items.map((item) => {
    const product = productById.get(item.productId);
    if (
      !product ||
      !product.isActive ||
      (product.lifecycleStatus != null && product.lifecycleStatus !== "active")
    ) {
      throw new Error("PRODUCT_NOT_SELLABLE");
    }
    const basePrice = Number(product.retailPrice);
    if (!Number.isFinite(basePrice) || basePrice < 0) {
      throw new Error("INVALID_PRODUCT_PRICE");
    }

    const modifiers = item.modifiers.map((requested) => {
      const requestedLabel = requested.label.trim();
      const configured = optionsByLabel
        .get(normalizedLabel(requestedLabel))
        ?.find(
          (option) =>
            !option.categoryIds?.length ||
            (product.categoryId != null &&
              option.categoryIds.includes(product.categoryId)),
        );
      if (!configured) {
        return { label: requestedLabel, priceDelta: 0 };
      }
      const priceDelta = Number(configured.priceDelta);
      if (!Number.isFinite(priceDelta)) {
        throw new Error("INVALID_MODIFIER_PRICE");
      }
      return { label: configured.label.trim(), priceDelta };
    });
    const modifierTotal = modifiers.reduce(
      (sum, modifier) => sum + modifier.priceDelta,
      0,
    );

    return {
      lineId: item.lineId,
      productId: product.id,
      productName: product.name,
      unitName: product.baseUnit,
      unitMultiplier: 1,
      quantity: item.quantity,
      basePrice,
      unitPrice: Math.max(0, basePrice + modifierTotal),
      modifiers,
      ...(item.note ? { note: item.note.trim() } : {}),
      course: item.course,
      courseDelayMinutes: item.courseDelayMinutes,
      sent: input.lockedSentLineIds.has(item.lineId),
    };
  });
}
