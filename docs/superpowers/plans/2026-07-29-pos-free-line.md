# POS Free Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add an explicit Free / No charge control to the POS line-price editor so a zero-revenue line still leaves inventory and reduces gross profit by its catalog cost.

**Architecture:** Keep the existing order schema and manual-price data path. Put editor state transitions and POS order-item payload construction in small pure modules, use those modules from the existing POS client, and protect the report economics with a PGlite integration regression.

**Tech Stack:** TypeScript, React 19, Next.js 16, next-intl, Bun tests, Drizzle ORM, PGlite.

## Global Constraints

- A free line has effective unit price and revenue `0`.
- The customer does not pay for the free line.
- The completed order retains the line and sold quantity.
- Stock-managed products still leave inventory.
- Gross profit subtracts every free unit's catalog cost.
- `275,000 revenue - 7,000 cost = 268,000 gross profit`.
- Directly entering unit price `0` has the same result as selecting Free.
- Do not add a database column, migration, payment method, or order-wide free mode.
- Existing explicit nonzero manual price and discount behavior must remain unchanged.

---

### Task 1: Test and implement free-line editor state

**Files:**
- Create: `src/lib/pos/line-price-editor.ts`
- Create: `tests/pos-free-line.test.tsx`

**Interfaces:**
- Produces: `LinePriceEditorState`
- Produces: `createLinePriceEditorState(unitPrice, lineDiscount): LinePriceEditorState`
- Produces: `setLinePriceInput(state, price): LinePriceEditorState`
- Produces: `setLineDiscountInput(state, discount): LinePriceEditorState`
- Produces: `setLineDiscountMode(state, mode): LinePriceEditorState`
- Produces: `setLineFree(state, free): LinePriceEditorState`
- Produces: `resolveLinePriceEditor(state): { unitPrice: number; lineDiscount: number; sellPrice: number }`

- [x] **Step 1: Write failing editor-state tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  createLinePriceEditorState,
  resolveLinePriceEditor,
  setLineFree,
  setLinePriceInput,
} from "@/lib/pos/line-price-editor";

describe("POS free line", () => {
  test("applies zero price and restores the draft when Free is unchecked", () => {
    const initial = createLinePriceEditorState(15_000, 1_000);
    const free = setLineFree(initial, true);

    expect(resolveLinePriceEditor(free)).toEqual({
      unitPrice: 0,
      lineDiscount: 0,
      sellPrice: 0,
    });

    expect(resolveLinePriceEditor(setLineFree(free, false))).toEqual({
      unitPrice: 15_000,
      lineDiscount: 1_000,
      sellPrice: 14_000,
    });
  });

  test("treats direct zero entry as Free", () => {
    const state = setLinePriceInput(
      createLinePriceEditorState(15_000, 0),
      "0",
    );

    expect(state.free).toBe(true);
    expect(resolveLinePriceEditor(state).sellPrice).toBe(0);
  });
});
```

- [x] **Step 2: Run the test and verify RED**

Run: `bun test tests/pos-free-line.test.tsx`

Expected: FAIL because `@/lib/pos/line-price-editor` does not exist.

- [x] **Step 3: Implement the minimal pure state module**

Implement string-backed price/discount drafts so clearing and re-entering
MoneyInput values remains possible. When Free is selected, preserve the
current `price`, `discount`, and discount mode in a restore snapshot, then set
price and discount drafts to `"0"`. When Free is unselected, restore that
snapshot. Direct non-empty zero price input follows the same transition.

`resolveLinePriceEditor` must:

```ts
const unitPrice = state.free ? 0 : Math.max(0, Number(state.price) || 0);
const discountInput = state.free ? 0 : Math.max(0, Number(state.discount) || 0);
const lineDiscount = state.discountMode === "pct"
  ? Math.round(unitPrice * discountInput / 100)
  : discountInput;
return {
  unitPrice,
  lineDiscount,
  sellPrice: Math.max(0, unitPrice - lineDiscount),
};
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `bun test tests/pos-free-line.test.tsx`

Expected: 2 tests pass.

- [x] **Step 5: Commit the state slice**

```bash
git add src/lib/pos/line-price-editor.ts tests/pos-free-line.test.tsx
git commit -m "feat(pos): model free line pricing"
```

### Task 2: Test and use the zero manual-price payload

**Files:**
- Create: `src/lib/pos/order-item-payload.ts`
- Modify: `tests/pos-free-line.test.tsx`
- Modify: `src/app/(pos)/pos/pos-client.tsx`

**Interfaces:**
- Consumes: a cart-line-like object with product identity, unit, quantity,
  unit price, optional line discount, and optional manual-price flag.
- Produces: `buildPosOrderItemPayload(line)` returning the existing order item
  shape with `manualUnitPrice: number | undefined`.

- [x] **Step 1: Add the failing payload test**

```ts
import { buildPosOrderItemPayload } from "@/lib/pos/order-item-payload";

test("keeps zero as an explicit manual unit price", () => {
  expect(buildPosOrderItemPayload({
    product: { id: "product-1", name: "Free bracket" },
    unitName: "cái",
    unitMultiplier: 1,
    quantity: 1,
    unitPrice: 0,
    lineDiscount: 0,
    manualPrice: true,
  })).toEqual({
    productId: "product-1",
    productName: "Free bracket",
    unitName: "cái",
    unitMultiplier: 1,
    quantity: 1,
    manualUnitPrice: 0,
    lineDiscount: 0,
  });
});
```

- [x] **Step 2: Run the test and verify RED**

Run: `bun test tests/pos-free-line.test.tsx`

Expected: FAIL because `@/lib/pos/order-item-payload` does not exist.

- [x] **Step 3: Implement and use the payload builder**

Create the pure builder with:

```ts
manualUnitPrice: line.manualPrice ? line.unitPrice : undefined
```

Replace both duplicated POS sale and return item mappings with the builder.
The return mapping adds its existing `restock` field after spreading the
builder result.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `bun test tests/pos-free-line.test.tsx`

Expected: 3 tests pass.

- [x] **Step 5: Commit the payload slice**

```bash
git add src/lib/pos/order-item-payload.ts src/app/'(pos)'/pos/pos-client.tsx tests/pos-free-line.test.tsx
git commit -m "refactor(pos): preserve zero manual line prices"
```

### Task 3: Add the Free control to the line-price editor

**Files:**
- Modify: `src/app/(pos)/pos/pos-client.tsx`
- Modify: `messages/vi.json`
- Modify: `messages/en.json`
- Modify: `tests/pos-free-line.test.tsx`

**Interfaces:**
- Consumes: Task 1 editor state functions.
- Preserves: `onApply(unitPrice: number, lineDiscount: number)`.

- [x] **Step 1: Add a failing rendered-control test**

Export a focused presentational `FreeLinePriceControl` from the pure POS
pricing module's companion component and render it with React server markup.
Assert that it renders a button with `role="switch"`, the localized label,
`aria-checked="true"` when selected, and a minimum 44px target.

- [x] **Step 2: Run the test and verify RED**

Run: `bun test tests/pos-free-line.test.tsx`

Expected: FAIL because `FreeLinePriceControl` does not exist.

- [x] **Step 3: Implement the control and wire the editor**

Create `src/components/pos/free-line-price-control.tsx` with:

```tsx
<button
  type="button"
  role="switch"
  aria-checked={checked}
  onClick={() => onCheckedChange(!checked)}
  className="flex min-h-11 w-full items-center justify-between rounded-lg border border-border px-3 py-2"
>
  <span>{label}</span>
  <span aria-hidden="true">{checked ? "✓" : ""}</span>
</button>
```

Update `LinePriceEditor` to:

- initialize Task 1 state from the cart line;
- use Task 1 setters for unit price, discount, mode, and Free;
- disable discount editing while Free is selected;
- show selling price from `resolveLinePriceEditor`;
- call the unchanged `onApply` with resolved unit price and line discount.

Add:

```json
"free": "Miễn phí / Không thu tiền"
```

and:

```json
"free": "Free / No charge"
```

under `pos.priceEditor`.

- [x] **Step 4: Run focused UI and pricing tests**

Run:

```bash
bun test tests/pos-free-line.test.tsx tests/mobile-pos-layout.test.tsx
```

Expected: all tests pass.

- [x] **Step 5: Commit the UI slice**

```bash
git add src/components/pos/free-line-price-control.tsx src/app/'(pos)'/pos/pos-client.tsx messages/vi.json messages/en.json tests/pos-free-line.test.tsx
git commit -m "feat(pos): add free line price control"
```

### Task 4: Prove free-line report economics

**Files:**
- Create: `tests/reports-free-line.test.mjs`

**Interfaces:**
- Consumes: existing Drizzle schema and `getReportsForDatabase`.
- Proves: zero line revenue, retained sold quantity, and negative line profit
  equal to catalog cost.

- [x] **Step 1: Write the PGlite integration regression**

Create a completed order with:

- total and paid amount `275000`;
- a revenue product line totaling `275000` with cost `0`;
- a free product line with quantity `1`, unit price/total `0`, and catalog cost
  `7000`.

Call `getReportsForDatabase(database, 1)` and assert:

```js
assert.equal(report.summary.revenue, 275000);
assert.equal(report.summary.grossProfit, 268000);
const free = report.topProducts.find((row) => row.productName === "Free bracket");
assert.equal(Number(free.qtySold), 1);
assert.equal(Number(free.revenue), 0);
assert.equal(Number(free.profit), -7000);
```

- [x] **Step 2: Run the integration test**

Run: `bun tests/reports-free-line.test.mjs`

Expected: PASS. This is a characterization test of existing server/report
economics; if it fails, change only the smallest responsible production logic.

- [x] **Step 3: Run final affected verification**

Run:

```bash
bun test tests/pos-free-line.test.tsx tests/order-schema.test.ts tests/mobile-pos-layout.test.tsx
bun tests/reports-free-line.test.mjs
bun tests/reports-net-returns.test.mjs
bunx eslint src/lib/pos/line-price-editor.ts src/lib/pos/order-item-payload.ts src/components/pos/free-line-price-control.tsx 'src/app/(pos)/pos/pos-client.tsx' tests/pos-free-line.test.tsx
bunx tsc --noEmit
```

Expected: focused tests, integration tests, and lint exit `0`. If repository
TypeScript fails only on known unrelated test-type errors, record the exact
output and confirm no new source error belongs to this change.

- [x] **Step 4: Review, commit, and push**

```bash
git diff --check
git status --short
git diff -- src/lib/pos/line-price-editor.ts src/lib/pos/order-item-payload.ts src/components/pos/free-line-price-control.tsx 'src/app/(pos)/pos/pos-client.tsx' messages/vi.json messages/en.json tests/pos-free-line.test.tsx tests/reports-free-line.test.mjs
git add docs/superpowers/plans/2026-07-29-pos-free-line.md src/lib/pos/line-price-editor.ts src/lib/pos/order-item-payload.ts src/components/pos/free-line-price-control.tsx 'src/app/(pos)/pos/pos-client.tsx' messages/vi.json messages/en.json tests/pos-free-line.test.tsx tests/reports-free-line.test.mjs
git commit -m "test(pos): verify free line profitability"
git push origin main
```
