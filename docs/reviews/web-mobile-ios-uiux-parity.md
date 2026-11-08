# LumaPOS Web Mobile ↔ iOS Native parity

> Implementation log — partial, not a completion certificate. Updated 2026-11-08.

## Baseline

- iOS reference: `luma-soft/luma-pos-mobile` `main` at `dabea3ec380d7ebfe909c00dbceb9a24806d540f`.
- Web baseline: `luma-soft/luma-pos-web` `main` at `f0e2767c9631d2fc0ee2c50f9b67c195dc5a4d00`.
- Web architecture: Next.js App Router; app and POS use separate layouts, both containing `MobileTabBar`. Inventory and Sales use navigation tabs.
- iOS reference: `AppSection.swift` provides 5 sections (Overview, Sales, Inventory, Invoices, More); technician navigation is More-only. `NativeInventoryFlowTabStrip` and `NativeInvoiceSectionTabBar` use horizontally scrollable, 56pt-high tabs with 3pt indicators.
- iOS uses SwiftUI native `TabView`; web can mirror navigation structure and appearance, not native UIKit behavior.

## Parity and implementation status

| Area | iOS Native | Web Mobile assessment | Status |
| --- | --- | --- | --- |
| Main navigation | 5 tabs; house, cart, shippingbox, document, ellipsis; technician More-only | Previously 5 tabs with different icons and unconditional visibility | Updated icon mapping, active states on nested routes, technician menu visibility, safe area |
| Inventory navigation | 56pt scrollable underline tabs | Previously 40–44px navigation tabs | Mobile-specific 56px / 3px indicator; desktop rules retained |
| Invoice section tabs | 56pt scrollable underline bar, no additional title block | Invoice-only 56px / 3px indicator; unrelated web group tabs restored to their earlier mobile style | Partially implemented |
| Dashboard | Store header, selected-range summary, quick actions, low stock, activity, receivables/payables | Store-name header and Today/Week/Month/Year presets added; activity/offline display still differs | Partially implemented |
| POS | Multiple open orders, product selectors, totals, quote confirmation | Mobile quote catalog CTA now reads Confirm; moves to existing cart details with VAT/discount before final Save Quote | Partially implemented |
| Inventory screen details | Native scrollable tabs plus product list/edit, filters, workflows | Removed duplicate mobile title and matched two-choice Products/Categories segmented control; workflows untouched | Partially implemented |
| Invoices | Customer and amount first, status/detail metadata below | Order-list mobile row restructured; selection/open/cancellation/print unchanged; other document rows remain | Partially implemented |
| More | Grouped actions, search, account/preferences | Added mobile-only accent-insensitive quick search, filtered by existing role/features; grouped actions remain | Partially implemented |
| Offline/PWA | Native local catalog cache | Web IndexedDB/Service Worker preserved | No sync logic changed; regression test pending |
| Desktop | Not applicable | Existing desktop layout is the baseline | Code changes are mobile-scoped; visual regression testing pending |

## Safety boundaries

1. No backend, schema, catalog, IndexedDB, offline queue or service-worker modifications.
2. Do not render duplicate layout/provider trees simply to hide them via CSS.
3. The tab's visibility is not authorization. Server-side permissions remain mandatory.
4. Only add mobile variants of layout classes (`lg:` restores previous desktop styles). Desktop still needs screenshot verification at 1024/1280/1440.
5. Do not claim complete parity until each screen is compared against SwiftUI subviews and tested.

## Remaining work

- Dashboard: separate activity feed, offline/cache/error states and chart visual parity; native date presets now supported.
- POS: line editor/unit switching, multiple-order tabs, search/filter/pickers, quote confirmation including VAT and discount, payment sheets.
- Inventory: grouped products, native list/filter/detail/edit workflows, stocktake, purchase, returns, internal use.
- Invoices and More: native filters, swipe/menus, form details and hidden features still pending. List summary rows and Mobile More search are implemented.
- Verify touch targets, scrolling, responsive at 360/375/390/402/430px, iPad landscape/portrait; Safari, Chrome and installed PWA.
- Run lint, typecheck, unit tests, build, and desktop before/after screenshot comparisons in a full checkout with dependencies.

## Verification limitations in this environment

The GitHub connector exposes repository contents but not a checked-out dependency tree or an authenticated browser session. A full Next.js lint/typecheck/build and authenticated responsive screenshots cannot be claimed here. Source-level invariants were checked for this navigation change. Further changes require the complete test matrix before declaring done.

## Dashboard follow-up implementation

- Mobile KPIs now use the selected dashboard range rather than querying a second fixed-today snapshot. This removes one dashboard query when the selected range is not today.
- Added gross profit and margin, low-stock product links, and recent orders with statuses in the mobile-only tree.
- The desktop dashboard component tree is unchanged; no backend business calculations were altered.
- Full visual/build regression remains unverified in this connector-only environment.

## More search addition

- A mobile-only search field is inserted above the existing More menu and matches Vietnamese text without accents, English text, labels, and helper descriptions.
- Results only include routes already exposed by the existing role/feature checks; links preserve external-target behavior.
- The old More groups, desktop markup, backend calls, and feature-gated entries remain in place.

## POS quotation confirmation (mobile only)

- Mobile catalog CTA for quote drafts now says `Xác nhận` / `Confirm`, matching the first-stage navigation action rather than incorrectly implying an immediate save.
- The CTA still opens the existing cart/settlement panel containing discount, VAT, shipping, customer and final `Lưu báo giá` action. No write, money calculation, tax preference, draft storage, or desktop action was changed.
- The full native quotation workflow still requires a simulator comparison and full payment/form regression testing.

## Invoice + Inventory navigation and order row alignment

- Sales and Inventory now omit the redundant mobile-only screen title header, retaining the existing desktop header from the `lg` breakpoint.
- The 56px iOS-like group tab treatment is opt-in (`nativeMobileStyle`) for Sales only; unrelated web group screens keep their existing compact mobile appearance.
- Mobile order list shows customer and amount on the first row, followed by status/payment/remaining, then date/code/channel. The full-row detail button, separately operable partner link, and multi-select checkbox are preserved.
- Added source-level Bun regression assertions for these invariants. Actual visual regression screenshots and typecheck/build remain pending.

## Quote, booking and inventory catalog presentation

- Added `MobileDocumentRow` for quote/booking rows. Both now present customer + amount first and keep the whole-row open action, customer link, and document metadata; the desktop data table columns are unmodified.
- Added Bun render assertions covering the common mobile row component and its optional fields.
- The Inventory Products/Categories switcher uses a mobile-only pill segmented style like `LumaSegmentedControl`. Desktop switcher colors, spacing and border remain behind `lg:` overrides.

## Returns document row

- Mobile return rows reuse `MobileDocumentRow` with red refund amounts. Status, reason, refund method, source invoice navigation, customer navigation, and whole-row expand action remain available.
- Desktop table, expanded footer, source order details and return data queries are unchanged.
- Added a render-level Bun assertion for return amount styling and accessible row label.

## More search result isolation

- `MobileMoreQuickSearch` now receives the server-rendered menu sections as children and hides those sections on small screens only when a nonempty search query is present. The results list is no longer duplicated above the unfiltered menu.
- Desktop shows the same menu sections via `lg:block`, even if search state is retained during a viewport change. Client-side search does not refetch, subscribe, or duplicate server components.

## POS iPhone draft selector

- Mobile catalog now shows the current draft as a single 48px picker with the number of open drafts. Tapping it opens a vertically stacked sheet with the same draft records and existing rename/change-type/delete actions.
- The same `invoices.map` tree is used for the sheet and desktop tab strip, avoiding duplicated draft state or subscriptions. Desktop keeps the horizontal tabs.
- Draft selection is keyboard-operable; the sheet can close via backdrop, close button or Escape. The create-draft menu placement now checks available viewport height.
- No change was made to draft persistence, POS checkout, products, tax, pricing, offline queue or server logic. Visual/simulator and full build verification remain pending.

## Dashboard native mobile presets
- Store name from authenticated context with LumaPOS fallback; no additional DB query.
- Week starts Monday, year begins January 1. Old desktop presets and data semantics are retained.
- Annual mobile chart groups existing response into months; desktop markup unchanged and no duplicate request.

## Inventory native product list row

- Mobile-only product rows now position 64px image / product name+SKU+category / selling price+unit+stock in one horizontal row, following `NativeProductRow` from iOS. Long product names and prices wrap instead of overflowing.
- Unit selection is an independent touch target above the full-row detail button; product selection and variant cost presentation remain functional.
- Thumbnail default stays 44px for existing uses, with a 64px opt-in only for mobile row. Desktop column definitions, catalog provider, pagination, unit projection and stock logic are unchanged.
- Added Bun source assertions for separate unit/action hit targets; no device visual test in the connector environment.

## Dashboard recent orders reference correction

- `DashboardRecentActivityView.swift` shows at most **two** recent invoice cards when order data is available, falling back to raw activity rows only when invoice cards are absent. An additional duplicated activity list is **not** needed.
- Web Mobile now shows the same two-order summary with customer name, amount, document code/date and status/payment; native card opens the invoice from the customer label. Existing backend still queries five, and desktop continues to render all original rows.

## CI coverage added

- A scoped GitHub Actions workflow `.github/workflows/mobile-parity-checks.yml` is configured to run Bun lockfile install, Next type generation, TypeScript, full ESLint and targeted Mobile parity tests on main changes.
- This is configuration only; **do not mark tests passed** until a real workflow run is checked. Vercel checks remain separate.

## Secondary Partners / Finance mobile layout

- Added opt-in `mobileSegmented` GroupTabs for two-way Partners and Finance navigation, with desktop classes intact.
- Customer (including walk-in) and supplier mobile card surfaces now open details from any empty area, not only by tapping a text link. Explicit links remain independently tappable, and desktop tables and actions are unchanged.

## iPhone input focus zoom prevention

- Search fields (`ListSearchInput`, searchable `Select`), shared textareas and read-only date fields use 16px font size on mobile to prevent Safari focus zoom; the prior 14px sizes are preserved from `lg` onwards.
- Shared `Input`/Select triggers already use 16px on mobile and remain unchanged. No input value handling or validation was modified.

## Native invoice history date grouping

- All four Web Mobile document tabs now show a localized day heading at each change of date within the existing result order, following `NativeInvoiceHistoryDayGroup` in iOS. Bookings use scheduled delivery date if present; other tabs use creation date.
- Added a pure `mobileDocumentDayHeadings` helper; it only processes fetched/paginated rows and adds no queries, sorting or historical data to offline catalog.
- Desktop table columns and row order are unchanged. This reproduces grouping within the current paginated page; cross-page/infinite scrolling parity remains future work.

## PWA security — no cached authenticated POS HTML

**Security issue found:** Previous `public/sw.js` cached successful `/pos` navigation HTML under an unscoped CacheStorage key and could replay one account's server-rendered POS data to another offline session.

- Service Worker v7 now caches only static Next assets, public icons and a deliberately generic `/offline.html`. It deletes older `lumapos-` caches (including the unsafe v6 POS HTML) on activation. It does not intercept/persist RSC or API responses.
- Online navigation is network-first; when offline, it shows a public recovery shell. Existing **already open** POS screens still retain their user/store-scoped local catalog and pending orders; those modules were not changed.
- **Known limitation:** Offline **cold launch** of a fully functional POS can no longer rely on cached private HTML. The safe recovery shell does not reconstruct the POS UI. A separate authenticated-independent offline app-shell boot mechanism would be required for full cold-launch parity. This task cannot be marked fully done until that is implemented and tested on device.
- No tenant/user/order data is embedded in the static fallback. Manifest start URL remains unchanged.

## CI coverage extension

- The GitHub Actions parity workflow also watches the public PWA shell/worker and runs all newly added partner, input-zoom, document-day, and Service Worker regression checks.

## Native product form tab strip and validation

- `NewProductForm` now mirrors `NativeProductFormTabsShell` on iPhone with three equal-width short tabs (48px touch targets), while desktop retains existing tab widths and spacing.
- Description tab uses the existing localized `products.tabs.description` translation instead of a Vietnamese-only hardcoded string.
- Invalid submission from either the Units/Variants **or Description** step now navigates back to Info when required Info fields are invalid. Existing form state, validation schema, save handlers and desktop layout are unchanged.

## Internal-use and Stock Mobile list rows

- Internal-use issues now have a native-style compact Mobile row showing document code, reason, total cost, status, time and recipient. Whole-row tap opens the existing detail panel with item list and authorized document actions.
- Stock tab uses a dedicated Mobile row with product name/SKU, stock severity, quantity, minimum stock and value. Whole-row tap opens the pre-existing product detail route. Both desktop tables, business queries and status/cost rules are unmodified.

## Receiving and supplier returns — native Mobile summaries

- Purchase receipt rows show supplier and status first, then date/code, item count, total and any outstanding balance, matching `NativePurchaseReceiptRowView`.
- Purchase return rows show supplier and refund amount first, then date/code, item count, status and supplier settlement, matching `NativePurchaseReturnRowView`.
- Existing row detail/authorized actions and desktop table definitions are unchanged, with no new data requests.

## Inventory skeleton consistency (streaming + offline cache)

- Product tab server Suspense, inner KeepPreviousContent and shared catalog's IndexedDB-loading state now show the **same** lightweight `MobileInventoryCatalogSkeleton`, so transitioning between server streaming and local cache hydration does not create visibly different consecutive skeleton layouts.
- Skeleton matches 64px mobile thumbnails and 94px rows; desktop continues to show the original `TableSkeleton` at `lg`. Existing server async boundary, cached product provider and error fallback remain intact.
- No extra provider, data request, product data copy or delayed polling was introduced.

## Full added Mobile test coverage

- GitHub Actions now invokes the product wizard, receiving/return, internal-use/stock, and unified catalog skeleton Bun assertions in addition to prior Mobile and PWA checks.

## Cashbook transactions — iOS Mobile row

- Cashbook Mobile rows now align with `NativeCashbookTransactionRow`: separate incoming/outgoing icons, counterparty, signed amount, category+note, timestamp/code/fund and cancelled state. The row expands the existing detail and authorized cancel/print controls.
- No change to desktop financial table, ledger data, cancellation permissions, or totals.
