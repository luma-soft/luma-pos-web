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
| Dashboard | Store header, selected-range summary, quick actions, low stock, activity, receivables/payables | Selected-range summary/profit, low-stock list, recent orders added; store header and chart still differ | Partially implemented |
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

- Dashboard: store-name header, year/week/month range parity and chart, separate activity feed, offline states. Current range values are constrained by the existing web backend.
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
