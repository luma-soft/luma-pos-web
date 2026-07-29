# Product list unit selector design

## Goal

Allow users to select a product's selling unit directly in the inventory
product list. The selected unit must consistently control every unit-dependent
value shown for that row.

## Scope

The feature applies to the desktop product table and the custom mobile product
row in `inventory/tabs/products-table.tsx`.

It changes only presentation state. It does not update product configuration,
prices, stock, orders, or any database record.

## Data contract

`getProducts()` will return the complete unit definitions for each row:

```ts
type ProductListUnit = {
  unitName: string;
  multiplier: string;
  priceOverride: string | null;
};
```

The base unit remains on the product row and has an implicit multiplier of `1`
with no price override. The existing unit-name summary may remain available for
other consumers, but the selector must use structured unit data rather than
parsing a display string.

## Selection behavior

Each row owns an independent selected-unit value in `ProductsTable` client
state, keyed by product ID.

- The initial selection is the product's base unit.
- A product with no alternate units renders the current plain unit label.
- A product with one or more alternate units renders a compact select control.
- Changing one row does not change any other row.
- Selection is session-only and resets to the base unit after navigation or
  reload.
- Pointer and keyboard interaction with the select must not trigger the table's
  row navigation.

## Derived values

For a selected unit with multiplier `M`:

- displayed cost = base cost × `M`;
- displayed retail price = unit `priceOverride` when present, otherwise base
  retail price × `M`;
- displayed stock = base-unit stock ÷ `M`;
- displayed reserved and minimum quantities, when shown in this row surface,
  use the same division;
- all displayed quantity labels use the selected unit name.

For the base unit, `M = 1`, so existing values are unchanged.

Product variant parents retain their existing price-range presentation unless
they have a coherent unit definition on the parent row. A selector must never
invent or merge incompatible child-unit definitions.

## Desktop UI

The Units column renders the select for multi-unit products. Cost, sale price,
and stock columns consume the row's selected-unit projection.

The control should match the existing table typography and use a visible focus
ring. It needs an accessible label containing the product name.

Sorting by cost, sale price, or stock must use the same selected-unit values
currently displayed.

## Mobile UI

The mobile product row will expose the same unit selector for multi-unit
products and display the selected retail price and stock. Single-unit products
keep the current compact layout.

The select must stop event propagation so changing the unit does not open the
product detail.

## Code boundaries

Unit arithmetic will live in a small pure helper module. It accepts base price,
stock, base unit, alternate units, and a selected unit name, and returns the
normalized selection plus derived values.

`ProductsTable` owns interactive state and renders the selector. The database
query only provides structured data; it does not perform per-selection
calculations.

## Error handling

- Unknown or stale selected unit names fall back to the base unit.
- Invalid, zero, or negative multipliers fall back to `1`.
- Missing retail override falls back to multiplied base retail price.
- Non-finite numeric inputs resolve to `0` for display rather than producing
  `NaN`.

## Verification

Test-driven implementation will cover:

1. base-unit projection;
2. alternate-unit cost and stock conversion;
3. retail price override;
4. multiplied retail fallback when no override exists;
5. invalid selection and invalid multiplier fallback;
6. selector rendering only for multi-unit products;
7. unit changes updating desktop and mobile prices and stock without triggering
   row navigation.

Affected lint, focused tests, TypeScript checks, and a production build will be
run before completion. Existing unrelated repository failures will be reported
separately.
