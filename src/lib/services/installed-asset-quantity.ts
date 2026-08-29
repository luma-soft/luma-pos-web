export const INSTALLED_ASSET_BATCH_LIMIT = 50;

type ProductDraft = {
  clientDraftId: string;
  productId: string | null;
};

export function resizeInstalledAssetProductDrafts<T extends ProductDraft>({
  drafts,
  productId,
  quantity,
  createDraft,
  maxTotal = INSTALLED_ASSET_BATCH_LIMIT,
}: {
  drafts: readonly T[];
  productId: string;
  quantity: number;
  createDraft: () => T;
  maxTotal?: number;
}) {
  const productDrafts = drafts.filter((draft) => draft.productId === productId);
  const otherDrafts = drafts.filter((draft) => draft.productId !== productId);
  const maximum = Math.max(1, maxTotal - otherDrafts.length);
  const normalizedQuantity = Math.min(
    maximum,
    Math.max(1, Math.trunc(Number.isFinite(quantity) ? quantity : 1)),
  );
  const nextProductDrafts = productDrafts.slice(0, normalizedQuantity);

  while (nextProductDrafts.length < normalizedQuantity) {
    nextProductDrafts.push(createDraft());
  }

  const removed = productDrafts.slice(normalizedQuantity);
  const firstProductIndex = drafts.findIndex((draft) => draft.productId === productId);
  const insertionIndex = firstProductIndex < 0
    ? otherDrafts.length
    : drafts.slice(0, firstProductIndex).filter((draft) => draft.productId !== productId).length;

  return {
    drafts: [
      ...otherDrafts.slice(0, insertionIndex),
      ...nextProductDrafts,
      ...otherDrafts.slice(insertionIndex),
    ],
    removed,
    quantity: normalizedQuantity,
  };
}
