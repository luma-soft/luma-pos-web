# Product List Unit Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-product unit selector to the inventory list so unit-dependent prices, stock, labels, and sorting update together on desktop and mobile.

**Architecture:** `getProducts()` supplies ordered structured alternate-unit definitions. A pure projection helper validates the selected unit and calculates its display values from base-unit values. `ProductsTable` owns transient selections keyed by product ID and passes one projection to both table columns and the mobile row.

**Tech Stack:** TypeScript 5, React 19, Next.js 16, Drizzle ORM, Bun test, Tailwind CSS.

## Global Constraints

- The base unit is always the initial selection and has multiplier `1`.
- Selection is presentation-only and must not persist to the database, URL, or browser storage.
- A multi-unit product renders a selector; a single-unit product keeps a plain unit label.
- Retail price uses `priceOverride` when present and otherwise uses base retail price multiplied by the unit multiplier.
- Cost uses base cost multiplied by the unit multiplier.
- Stock, reserved stock, and minimum stock use base quantities divided by the unit multiplier.
- Invalid selections fall back to the base unit; invalid, zero, or negative multipliers fall back to `1`.
- Selector pointer and keyboard interaction must not trigger product-row navigation.
- Variant parents keep their existing range display unless the parent itself has coherent alternate-unit definitions.
- When a variant range is sortable, use its displayed lower bound as the numeric sort value.
- Existing unrelated working-tree changes must not be staged or modified.

---

## File Structure

- Create `src/lib/product-unit-projection.ts`: pure types, validation, and arithmetic for one selected product unit.
- Create `tests/product-unit-projection.test.ts`: focused behavior tests for base, alternate, override, and fallback projections.
- Modify `src/lib/data/products.ts`: return ordered `unitDefinitions` JSON for both top-level and child product rows.
- Modify `src/app/(app)/inventory/tabs/products-table.tsx`: own row selections, render the reusable selector, build the unit-dependent columns, project desktop/mobile values, and expose projected sort values.
- Modify `tests/mobile-final-table-surfaces.test.tsx`: exercise the real list/mobile render seams and event handlers.

### Task 1: Pure unit projection

**Files:**
- Create: `tests/product-unit-projection.test.ts`
- Create: `src/lib/product-unit-projection.ts`

**Interfaces:**
- Consumes: numeric or numeric-string base values and database unit definitions.
- Produces:

```ts
export type ProductListUnit = {
  unitName: string;
  multiplier: string;
  priceOverride: string | null;
};

export type ProductUnitProjectionInput = {
  baseUnit: string;
  costPrice: number | string;
  retailPrice: number | string;
  totalStock: number | string;
  reservedStock: number | string;
  minLevel: number | string;
  unitDefinitions: readonly ProductListUnit[];
  selectedUnitName?: string;
};

export type ProductUnitProjection = {
  unitName: string;
  multiplier: number;
  costPrice: number;
  retailPrice: number;
  totalStock: number;
  reservedStock: number;
  minLevel: number;
  hasAlternateUnits: boolean;
};

export function projectProductUnit(
  input: ProductUnitProjectionInput,
): ProductUnitProjection;
```

- [ ] **Step 1: Write failing tests for base and alternate arithmetic**

Create table-driven Bun tests with literal expected values:

```ts
import { describe, expect, test } from "bun:test";
import { projectProductUnit } from "@/lib/product-unit-projection";

const product = {
  baseUnit: "m",
  costPrice: "3500",
  retailPrice: "4400",
  totalStock: "1000",
  reservedStock: "25",
  minLevel: "50",
  unitDefinitions: [
    { unitName: "cuộn", multiplier: "500", priceOverride: "2100000" },
  ],
};

describe("projectProductUnit", () => {
  test("keeps base-unit values when no alternate unit is selected", () => {
    expect(projectProductUnit(product)).toEqual({
      unitName: "m",
      multiplier: 1,
      costPrice: 3500,
      retailPrice: 4400,
      totalStock: 1000,
      reservedStock: 25,
      minLevel: 50,
      hasAlternateUnits: true,
    });
  });

  test("multiplies prices and divides quantities for an alternate unit", () => {
    expect(projectProductUnit({
      ...product,
      selectedUnitName: "cuộn",
      unitDefinitions: [
        { unitName: "cuộn", multiplier: "500", priceOverride: null },
      ],
    })).toMatchObject({
      unitName: "cuộn",
      multiplier: 500,
      costPrice: 1_750_000,
      retailPrice: 2_200_000,
      totalStock: 2,
      reservedStock: 0.05,
      minLevel: 0.1,
    });
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the RED state**

Run:

```bash
bun test tests/product-unit-projection.test.ts
```

Expected: FAIL because `@/lib/product-unit-projection` does not exist.

- [ ] **Step 3: Add override and invalid-input tests**

Add literal assertions proving:

```ts
expect(projectProductUnit({
  ...product,
  selectedUnitName: "cuộn",
}).retailPrice).toBe(2_100_000);

expect(projectProductUnit({
  ...product,
  selectedUnitName: "không tồn tại",
})).toMatchObject({ unitName: "m", multiplier: 1, retailPrice: 4400 });

expect(projectProductUnit({
  ...product,
  selectedUnitName: "cuộn",
  unitDefinitions: [
    { unitName: "cuộn", multiplier: "0", priceOverride: "không hợp lệ" },
  ],
})).toMatchObject({
  unitName: "cuộn",
  multiplier: 1,
  costPrice: 3500,
  retailPrice: 4400,
  totalStock: 1000,
});
```

- [ ] **Step 4: Implement the minimal pure helper**

Implement finite-number normalization, exact selected-unit lookup, positive multiplier fallback, optional override handling, and the returned projection:

```ts
function finiteNumber(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function projectProductUnit(
  input: ProductUnitProjectionInput,
): ProductUnitProjection {
  const selected = input.unitDefinitions.find(
    (unit) => unit.unitName === input.selectedUnitName,
  );
  const rawMultiplier = selected ? finiteNumber(selected.multiplier) : 1;
  const multiplier = rawMultiplier > 0 ? rawMultiplier : 1;
  const override = selected?.priceOverride;
  const hasValidOverride =
    override !== null && override !== undefined && Number.isFinite(Number(override));

  return {
    unitName: selected?.unitName ?? input.baseUnit,
    multiplier,
    costPrice: finiteNumber(input.costPrice) * multiplier,
    retailPrice: hasValidOverride
      ? Number(override)
      : finiteNumber(input.retailPrice) * multiplier,
    totalStock: finiteNumber(input.totalStock) / multiplier,
    reservedStock: finiteNumber(input.reservedStock) / multiplier,
    minLevel: finiteNumber(input.minLevel) / multiplier,
    hasAlternateUnits: input.unitDefinitions.length > 0,
  };
}
```

- [ ] **Step 5: Run the focused test and confirm GREEN**

Run:

```bash
bun test tests/product-unit-projection.test.ts
```

Expected: all projection tests PASS with no warnings.

- [ ] **Step 6: Commit the pure behavior**

```bash
git add src/lib/product-unit-projection.ts tests/product-unit-projection.test.ts
git commit -m "feat: add product unit display projection"
```

### Task 2: Structured unit data in the product list

**Files:**
- Modify: `src/lib/data/products.ts:250-265`
- Modify: `src/lib/data/products.ts:318-332`
- Test: `tests/product-unit-projection.test.ts`

**Interfaces:**
- Consumes: `product_units.unit_name`, `multiplier`, `price_override`, and `sort_order`.
- Produces: `unitDefinitions: ProductListUnit[]` on every top-level and child `ProductRow`.

- [ ] **Step 1: Add a type-level consumer fixture that fails without structured data**

Extend the projection test with a fixture using the exact query result contract:

```ts
import type { ProductListResult } from "@/lib/data/products";

function firstUnit(row: ProductListResult["rows"][number]) {
  return row.unitDefinitions[0];
}

test("accepts the structured unit contract returned by getProducts", () => {
  const row = {
    unitDefinitions: [
      { unitName: "cuộn", multiplier: "305", priceOverride: "2500000" },
    ],
  } as ProductListResult["rows"][number];

  expect(firstUnit(row)).toEqual({
    unitName: "cuộn",
    multiplier: "305",
    priceOverride: "2500000",
  });
});
```

- [ ] **Step 2: Run TypeScript on the focused test and confirm RED**

Run:

```bash
bunx tsc --noEmit --pretty false 2>&1 | rg "product-unit-projection.test|unitDefinitions"
```

Expected: an error that `unitDefinitions` does not exist on the `getProducts()` row type.

- [ ] **Step 3: Add ordered JSON aggregation to both row queries**

Add this selected field beside `unitNames` in the top-level and child queries:

```ts
unitDefinitions: sql<Array<{
  unitName: string;
  multiplier: string;
  priceOverride: string | null;
}>>`coalesce((
  select json_agg(json_build_object(
    'unitName', ${productUnits.unitName},
    'multiplier', ${productUnits.multiplier},
    'priceOverride', ${productUnits.priceOverride}
  ) order by ${productUnits.sortOrder})
  from ${productUnits}
  where ${productUnits.productId} = ${products.id}
), '[]'::json)`,
```

Keep `unitNames` temporarily because existing consumers may still read it.

- [ ] **Step 4: Re-run the type contract and focused behavior tests**

Run:

```bash
bun test tests/product-unit-projection.test.ts
bunx tsc --noEmit --pretty false 2>&1 | rg "product-unit-projection.test|unitDefinitions" || true
```

Expected: projection tests PASS and no TypeScript diagnostic mentions the new test or `unitDefinitions`. Unrelated pre-existing diagnostics may remain.

- [ ] **Step 5: Commit the data contract**

```bash
git add src/lib/data/products.ts tests/product-unit-projection.test.ts
git commit -m "feat: expose product units in inventory list"
```

### Task 3: Interactive desktop and mobile unit selection

**Files:**
- Modify: `src/app/(app)/inventory/tabs/products-table.tsx:1-205`
- Modify: `src/app/(app)/inventory/tabs/products-table.tsx:246-305`
- Modify: `tests/mobile-final-table-surfaces.test.tsx:490-550`

**Interfaces:**
- Consumes: `projectProductUnit(input)`, `ProductRow.unitDefinitions`, and existing `stopRowToggle`.
- Produces:

```ts
export function ProductUnitSelector(props: {
  productName: string;
  baseUnit: string;
  units: readonly ProductListUnit[];
  value: string;
  onChange: (unitName: string) => void;
}): React.ReactNode;

export function buildProductUnitColumns(options: {
  labels: {
    units: string;
    cost: string;
    salePrice: string;
    stock: string;
    stockNotTracked: string;
  };
  selectedUnitName: (product: ProductRow) => string;
  onUnitChange: (product: ProductRow, unitName: string) => void;
}): DataTableColumn<ProductRow>[];
```

`ProductMobileRow` additionally consumes:

```ts
selectedUnitName: string;
onUnitChange: (unitName: string) => void;
```

- [ ] **Step 1: Write failing selector render and event tests**

In `tests/mobile-final-table-surfaces.test.tsx`, import `ProductUnitSelector` and verify real rendered behavior:

```tsx
const single = ProductUnitSelector({
  productName: "Router",
  baseUnit: "cái",
  units: [],
  value: "cái",
  onChange: () => undefined,
});
expect(renderToStaticMarkup(single)).not.toContain("<select");
expect(renderToStaticMarkup(single)).toContain("cái");

const changes: string[] = [];
const multi = ProductUnitSelector({
  productName: "Dây mạng",
  baseUnit: "m",
  units: [{ unitName: "cuộn", multiplier: "305", priceOverride: null }],
  value: "m",
  onChange: (unit) => changes.push(unit),
});
const select = elementsOfType(multi, "select")[0];
expect(renderToStaticMarkup(multi)).toContain('aria-label="Đơn vị tính Dây mạng"');
(select.props.onChange as (event: { currentTarget: { value: string } }) => void)({
  currentTarget: { value: "cuộn" },
});
expect(changes).toEqual(["cuộn"]);
```

Also invoke `onClick`, `onPointerDown`, and `onKeyDown` with unique event objects and expect the existing `stoppedRowToggleEvents` seam to receive them.

- [ ] **Step 2: Run the component test and confirm RED**

Run:

```bash
bun test tests/mobile-final-table-surfaces.test.tsx
```

Expected: FAIL because `ProductUnitSelector` is not exported.

- [ ] **Step 3: Implement `ProductUnitSelector` and row selection state**

Add:

```tsx
const [selectedUnits, setSelectedUnits] = useState<Record<string, string>>({});

const selectedUnitName = (product: ProductRow) =>
  selectedUnits[product.id] ?? product.baseUnit;

const projectionFor = (product: ProductRow) =>
  projectProductUnit({
    baseUnit: product.baseUnit,
    costPrice: product.costPrice,
    retailPrice: product.retailPrice,
    totalStock: product.totalStock,
    reservedStock: product.reservedStock,
    minLevel: product.minLevel,
    unitDefinitions: product.unitDefinitions,
    selectedUnitName: selectedUnitName(product),
  });

const changeUnit = (productId: string, unitName: string) => {
  setSelectedUnits((current) => ({ ...current, [productId]: unitName }));
};
```

The selector renders the base option first, alternate options in query order, uses the existing table palette/focus styles, and calls `stopRowToggle` for click, pointer-down, and key-down events.

- [ ] **Step 4: Write failing desktop projection and sorting tests**

Call `buildProductUnitColumns()` with one cable row containing base unit `m`, alternate `cuộn`, multiplier `500`, override `2100000`, base cost `3500`, base retail `4400`, and base stock `1000`. Provide `selectedUnitName: () => "cuộn"` so the test exercises the selected-unit branch without a DOM or a mocked state container.

Locate `units`, `cost`, `salePrice`, and `stock` in the returned columns and assert literal rendered and sort outputs:

```ts
expect(renderToStaticMarkup(costColumn.render(cable))).toContain("1.750.000");
expect(renderToStaticMarkup(saleColumn.render(cable))).toContain("2.100.000");
expect(renderToStaticMarkup(stockColumn.render(cable))).toContain("2 cuộn");
expect(costColumn.sortValue?.(cable)).toBe(1_750_000);
expect(saleColumn.sortValue?.(cable)).toBe(2_100_000);
expect(stockColumn.sortValue?.(cable)).toBe(2);
```

The production mutation caught is any column or sorter continuing to use base-unit values after a selection change.

- [ ] **Step 5: Implement projected desktop columns**

Implement `buildProductUnitColumns()` and have `ProductsTable` spread its result into `columns`. Use the selected-unit projection consistently:

- `units.render`: `ProductUnitSelector`.
- `cost.render`: projected value for ordinary rows; preserve variant-parent range when no parent alternate units exist.
- `salePrice.render`: projected value with override/fallback; preserve unsupported variant-parent range.
- `stock.render`: call `productStockDisplay` with `{ ...product, totalStock: projection.totalStock, baseUnit: projection.unitName }`.
- `stock.cellClassName`: compare projected `totalStock` and projected `minLevel`.
- `cost.sortValue`, `salePrice.sortValue`, and `stock.sortValue`: return the same projected numeric values that are rendered.

For a variant parent with its own alternate unit, multiply both ends of cost and retail ranges by the selected multiplier; a retail `priceOverride` renders as one retail value. For a variant parent without its own alternate unit, render the current unmodified ranges. Range sorting uses the displayed lower bound.

Pass translated labels and state callbacks from `ProductsTable`:

```tsx
...buildProductUnitColumns({
  labels: {
    units: t("products.list.colUnits"),
    cost: t("products.list.colCost"),
    salePrice: t("products.list.colSalePrice"),
    stock: t("products.list.colStock"),
    stockNotTracked: t("products.stock.notTracked"),
  },
  selectedUnitName,
  onUnitChange: (product, unitName) => changeUnit(product.id, unitName),
}),
```

- [ ] **Step 6: Write failing mobile projection and event-isolation tests**

Call `ProductMobileRow` with `selectedUnitName: "cuộn"` and assert its real markup contains `2.100.000`, `2 cuộn`, and the selector. Invoke select click/key/change handlers and assert that the row `onOpen` callback was not called. Verify the selector is a sibling of the open-detail button, not a descendant, so the markup never nests a `<select>` inside a `<button>`.

The production mutation caught is a mobile row displaying base-unit price/stock or opening detail while the unit control is used.

- [ ] **Step 7: Implement projected mobile content**

Compute the same projection inside `ProductMobileRow`. Change the row structure to a non-interactive wrapper containing the existing open-detail button and a sibling selector area; this preserves the full-row open action without nesting interactive controls. Pass controlled values from `ProductsTable`:

```tsx
<ProductMobileRow
  product={product}
  selectedUnitName={selectedUnitName(product)}
  onUnitChange={(unitName) => changeUnit(product.id, unitName)}
  {...existingProps}
/>
```

Keep the product content as the open-detail button. The sibling selector must remain independently keyboard accessible and stop events before they reach the table row.

- [ ] **Step 8: Run focused tests and refactor only while GREEN**

Run:

```bash
bun test tests/product-unit-projection.test.ts tests/mobile-final-table-surfaces.test.tsx tests/product-stock-display.test.ts
```

Expected: all focused tests PASS without new warnings.

- [ ] **Step 9: Run affected lint and TypeScript diagnostics**

Run:

```bash
bunx eslint src/lib/product-unit-projection.ts src/lib/data/products.ts 'src/app/(app)/inventory/tabs/products-table.tsx' tests/product-unit-projection.test.ts tests/mobile-final-table-surfaces.test.tsx
bunx tsc --noEmit --pretty false
```

Expected: affected ESLint files PASS. Record unrelated baseline TypeScript errors separately; no diagnostic may point to a task-owned file.

- [ ] **Step 10: Run the production build**

Run:

```bash
bun run build
```

Expected: build succeeds. If it fails only on a known unrelated repository baseline, preserve the complete failure evidence and verify no task-owned file appears in the diagnostic.

- [ ] **Step 11: Commit and push the completed feature**

```bash
git add src/lib/product-unit-projection.ts src/lib/data/products.ts 'src/app/(app)/inventory/tabs/products-table.tsx' tests/product-unit-projection.test.ts tests/mobile-final-table-surfaces.test.tsx
git commit -m "feat: add inventory unit selector"
git push origin main
```
