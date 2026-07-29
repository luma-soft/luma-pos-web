# POS Free Line Design

## Goal

Allow a cashier to mark a POS product line as free, or enter a selling price of
zero, while preserving stock movement and cost-of-goods recognition.

## Business Rules

- A free line has an effective selling price and line revenue of `0`.
- The customer does not pay for the free line.
- The line remains part of the completed order.
- The sold quantity remains included in product sales reporting.
- A stock-managed product is still deducted from inventory.
- Its cost remains included in gross-profit calculations.
- Therefore a free line reduces order gross profit by its cost:
  `275,000 revenue - 7,000 cost = 268,000 gross profit`.
- “Included in revenue reporting” means the line remains represented in the
  order and report aggregates with zero revenue. It does not mean adding the
  former selling price to revenue.

## POS Interaction

Add a **Free / No charge** control to the existing line-price editor.

- Selecting the control sets the editor's selling price to zero.
- Entering `0` directly in the unit-price field has the same financial result.
- Applying the editor writes a manual unit price of zero through the existing
  POS order payload.
- The cart line total, order subtotal, tax base, payment amount, and printed
  line total all use zero for that line.
- The control does not add a new discount, payment method, or order-wide mode.

## Data Flow

Use the existing manual-price contract:

1. POS sends `manualUnitPrice: 0` for the line.
2. Server normalization keeps the trusted effective unit price at zero.
3. The completed order stores `order_items.unit_price = 0` and
   `order_items.total = 0`.
4. Normal order completion still consumes inventory.
5. Existing report profit calculations subtract
   `quantity × unitMultiplier × product.costPrice` from the zero line revenue.

No database migration or persistent `isFree` flag is needed. This keeps the
change compatible with existing orders, offline payloads, invoice editing, and
report queries.

## Validation and Edge Cases

- Negative prices remain invalid and are clamped or rejected by existing
  validation.
- A zero-priced line must not be removed from the order.
- Quantity greater than one recognizes cost for every unit.
- Non-stock service lines have zero revenue and no inventory cost unless their
  catalog cost already participates in the existing profit calculation.
- Order-level discount and tax continue to operate on the resulting subtotal.
- Explicitly unselecting Free before applying restores normal editable pricing
  within the editor; it does not mutate the cart until Apply is pressed.

## Verification

- Unit-test the editor state transition: selecting Free produces an applied
  unit price of zero, and direct zero entry has the same result.
- Verify the POS request contains `manualUnitPrice: 0`.
- Add an integration regression proving a completed zero-revenue product line
  remains in sales quantity and reduces gross profit by its cost.
- Run affected POS, order normalization, report, TypeScript, and lint checks.
