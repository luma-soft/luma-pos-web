# KiotViet Remaining Data Synchronization Design

## Goal

Synchronize the seven remaining KiotViet exports into the `hai-dang` LumaPOS store after the product catalog synchronization. KiotViet is authoritative for source-owned customer, supplier, booking, sale, purchase, customer-return, and supplier-return records. LumaPOS-native records that are absent from KiotViet remain unchanged.

This is a controlled historical-data migration, not a live integration. Every production write is preceded by a deterministic dry-run against the exact reviewed workbook hash.

## Source bundle reviewed

| Domain | Workbook | Source size | Current LumaPOS observations |
| --- | --- | ---: | --- |
| Customers | `DanhSachKhachHang_KV30082026-225042-104.xlsx` | 103 customers | 95 matched, 8 missing, 11 debt mismatches, 18 total-spent mismatches |
| Suppliers | `DanhSachNhaCungCap_KV30082026-225048-447.xlsx` | 59 suppliers | 58 matched, 1 missing, 11 debt mismatches |
| Bookings | `DanhSachChiTietDatHang_KV30082026-225705-529.xlsx` | 23 documents / 361 lines | Not imported by the legacy history importer |
| Sales | `DanhSachChiTietHoaDon_KV30082026-225731-462.xlsx` | 2,839 invoices / 9,305 lines | 2,640 matched, 199 missing |
| Purchases | `DanhSachChiTietNhapHang_KV30082026-225820-542.xlsx` | 1,169 receipts / 4,611 lines | 1,091 matched, 78 missing; 1,089 matched receipts have an incorrect zero subtotal |
| Customer returns | `DanhSachChiTietTraHang_KV30082026-225644-550.xlsx` | 113 returns / 440 lines | 104 matched, 9 missing; 63 partial-return parents are incorrectly marked fully returned |
| Supplier returns | `DanhSachChiTietTraHangNhap_KV30082026-225857-429.xlsx` | 65 returns / 198 lines | 62 matched, 3 missing; 52 unpaid/partial records have an incorrect settlement status |

The product workbook is no longer part of this program. The completed product synchronization and its source mappings are prerequisites for resolving product and alternate-unit identities.

## Non-negotiable invariants

1. Customer and supplier snapshot phases may update their own master balances. Every later historical-document phase must leave product stock, customer debt/total spent, supplier debt, cashbook balances, stock reservations, stock lots, and stock movements exactly unchanged.
2. Historical imports write ledger documents directly through a dedicated database adapter. They do not call normal sale, purchase, payment, return, notification, or inventory actions because those actions intentionally create operational side effects.
3. LumaPOS-native records that have no KiotViet provenance are preserved.
4. Source-owned data is reconciled in place and is idempotent. A second dry-run after a successful apply must report zero managed-field changes.
5. No physical deletion is used for master data. Missing or inactive source-owned partners are made inactive; Luma-only partners remain unchanged.
6. Absence from a historical document export is not interpreted as deletion or cancellation. Only documents present in the workbook are adopted or reconciled, and only an explicit source status can change their status.
7. Every database read, write, uniqueness check, and relationship lookup is scoped by `store_id`.
8. Production application requires `--apply`, the exact `--store=hai-dang`, and the SHA-256 printed by the reviewed dry-run.

## Provenance and run audit

Add two server-only tables:

- `kiotviet_sync_runs`: store, phase, source filename, SHA-256, source counts, status, summary, timestamps, and error details for each applied transaction.
- `kiotviet_source_mappings`: `(store_id, provider, entity_type, external_id) -> local_id`, source hash, last-seen run, adoption method, and inactive/deleted timestamp.

The mapping entity types cover customers, suppliers, bookings, sales, sale lines, sale payments, purchases, purchase lines, customer returns, return lines, supplier returns, and supplier-return lines. Product identity continues to use `product_source_mappings` created by the product synchronization.

The operational tables are not client APIs. Enable RLS, revoke `anon` and `authenticated`, and access them only from the server-side CLI/database adapter. A polymorphic mapping cannot have a direct foreign key to every target table, so the adapter validates the target table, target store, and local UUID before every mapping write.

## Matching and initial adoption

- Match a master or document by an existing source mapping first.
- On the first run, an exact source code may be adopted only when its document type and normalized fingerprint agree with the workbook, or when it carries the known legacy-import marker.
- A same-code LumaPOS record with conflicting type, totals, dates, or lines is a collision. Dry-run blocks that entity instead of overwriting it.
- Child rows use stable source keys derived from document code, normalized SKU/unit, and occurrence number so duplicate product lines remain distinguishable.
- Existing child IDs are retained when safely matched, especially when returns or allocations reference them. Unreferenced source-owned child rows may be replaced; Luma-native payments and downstream references are never silently deleted.

## Partner master synchronization

### Customers

KiotViet manages code, name, phone, email, address, tax code, note, active state, signed current debt, and `totalSpent = Tổng bán trừ trả hàng`. Negative debt is preserved as customer credit rather than clamped to zero.

LumaPOS-specific consent, Zalo, portal token, debt limit, and customer-segment type are preserved. KiotViet's `Loại khách` describes legal/person classification and does not safely map to LumaPOS's retail/wholesale/contractor/agent segment. New customers default to `retail`.

### Suppliers

KiotViet manages code, name, phone, email, address, tax code, note, active state, and signed current debt. Add `suppliers.is_active` because the existing schema cannot represent an inactive supplier. LumaPOS-only suppliers remain active and unchanged.

If a historical document references a non-empty customer or supplier code absent from the current master snapshot, create an inactive historical placeholder with provenance. Anonymous sales keep `customer_id = null`. Purchases with no supplier code use one tenant-scoped inactive `KiotViet unknown supplier` placeholder because `purchase_orders.supplier_id` is mandatory.

## Product and unit resolution for history

Resolve every line in this order:

1. exact current base-product SKU;
2. exact `product_units.sku`, yielding the parent product, source unit, and multiplier;
3. an archived product from `product_source_mappings`;
4. an inactive historical product placeholder with a stable KiotViet mapping.

Alternate-unit SKUs must never recreate the legacy duplicate-product placeholders. Sales, bookings, and customer returns store the source quantity plus `unitMultiplier`. Purchase and supplier-return line schemas need unit snapshot fields so their alternate-unit quantities are represented without losing the source unit or corrupting totals.

The reviewed history contains 2,616 unique SKUs. Of these, 277 alternate-unit SKUs occur on 1,075 lines. Product resolution must be complete before any document phase can apply.

## Historical document semantics

### Bookings (`DatHang`)

- Map to `orders.document_type = booking`.
- `Hoàn thành -> completed`; `Phiếu tạm -> draft`. Completed historical bookings must not remain convertible into another sale.
- Preserve totals, payment snapshot, delivery time, note, customer, and line units.
- Do not reserve stock and do not create cashbook, debt, or notification records.
- Sales later link to their source booking through `orders.source_order_id` using `Mã đặt hàng`.

### Sales invoices (`HoaDon`)

- Reconcile 2,640 previously imported invoices and create the 199 missing invoices.
- Preserve source header totals and each non-zero payment channel as a source-owned payment row. Payment rows do not create cashbook entries.
- Anonymous invoices remain anonymous. Zero-price lines are valid and are not rejected.
- Link source bookings when `Mã đặt hàng` resolves.
- Do not create stock movements, stock-level deltas, debt changes, total-spent changes, e-invoices, shifts, or notifications.

### Purchase receipts (`NhapHang`)

- Reconcile 1,091 existing receipts and create 78 missing receipts.
- Map `Đã nhập hàng -> received` and `Phiếu tạm -> draft`.
- Correct subtotal, receipt discount, VAT/tax, total payable, amount paid, invoice number, supplier, line units, line cost, and totals.
- In particular, repair the 1,089 existing source receipts whose LumaPOS subtotal is incorrectly zero.
- Do not receive stock, create lots/movements, change supplier debt, or create cashbook rows.

### Customer returns (`TraHang`)

- Link the source invoice and exact order item when possible. When the invoice is absent or a line cannot be matched safely, preserve the return as an unlinked/partially linked historical return and report the exception.
- Add return settlement snapshot fields so `Cần trả khách` and `Đã trả khách` are both represented.
- Recompute the parent sale status from cumulative active return quantities. Mark `returned` only when every sale line is fully returned; otherwise keep the sale `completed`.
- Do not restock, move lots, change debt/total spent, issue refunds, write cashbook rows, or publish notifications.

### Supplier returns (`TraHangNhap`)

- Preserve supplier, source unit, quantity, return cost, discounts, VAT, amount due from supplier, and amount already paid by supplier.
- Settlement is `unsettled` when paid is zero, `partial` when `0 < paid < total`, and `settled` only when paid covers the total.
- The export has no original purchase-receipt code. Leave `purchase_order_id` and `purchase_order_item_id` null unless an exact non-heuristic source relationship becomes available; never guess by dates or similar totals.
- Do not reduce stock, consume lots, change supplier debt, create cashbook rows, or publish notifications.

## Schema extensions required

- `suppliers.is_active`.
- `returns.refund_amount` and `returns.settlement_status`.
- Purchase line snapshot fields needed for source SKU, product name, unit name, and unit multiplier.
- `purchase_return_items.unit_multiplier`.
- `kiotviet_sync_runs` and `kiotviet_source_mappings` with tenant constraints, RLS, and server-only privileges.

Existing application reads and forms must receive safe defaults for old rows. No existing operational write path is changed to use the migration adapter.

## Execution and rollback

Each phase runs in its own transaction and executes pre/post invariant queries inside the transaction. An invariant mismatch rolls back that phase. Before the first production apply, export a store-scoped backup of every affected master/document table and its child rows.

The CLI is dry-run by default:

```text
bun sync:kiotviet-data <directory> --store=hai-dang --phase=<phase>
bun sync:kiotviet-data <directory> --store=hai-dang --phase=<phase> --apply --source-sha256=<reviewed-hash>
```

`--phase=all` is allowed only for dry-run. Production applies remain phase-by-phase so the user can review the exact create/update/adopt/conflict counts before each transaction.

## Completion criteria

- Every source header and line total reconciles to the workbook within currency/quantity precision.
- Every source entity is mapped, intentionally anonymous, or listed as a blocking exception.
- LumaPOS-native entities remain unchanged.
- Stock, lots, reservations, movements, cashbook, debt ledgers, and notification/outbox invariants pass after every history phase.
- Customer/supplier balances equal their source master snapshots before history imports start and remain equal afterward.
- Full rerun dry-run reports zero managed changes and zero unresolved collisions.
