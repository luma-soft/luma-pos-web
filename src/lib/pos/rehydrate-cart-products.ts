export function rehydrateCartProducts<
  TProduct extends { id: string },
  TLine extends { product: TProduct },
>(cart: readonly TLine[], currentProducts: readonly TProduct[]): TLine[] {
  const currentById = new Map(currentProducts.map((product) => [product.id, product]));
  return cart.map((line) => ({
    ...line,
    product: currentById.get(line.product.id) ?? line.product,
  }));
}
