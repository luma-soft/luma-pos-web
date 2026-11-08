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
| Invoice/other group tabs | 56pt scrollable underline tab bar | Previously 44px small-text tabs | Mobile-only height, font and indicator alignment |
| Dashboard | Store header, selected-range summary, quick actions, low stock, activity, receivables/payables | Selected-range summary/profit, low-stock list, recent orders added; store header and chart still differ | Partially implemented |
| POS | Multiple open orders, product selectors, totals, quote confirmation | Significant separate web flow | Not yet changed |
| Inventory screen details | Product list/edit, filters, document workflows, offline provider | Existing web implementations | Not yet changed |
| Invoices | Sales/returns/quotes/bookings, filters, details, merge/print | Existing web implementations | Not yet changed |
| More | Grouped actions, search, account/preferences | Existing web grouped actions, search parity pending | Not yet changed |
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
- Invoices and More: native grouping, search, filters, swipe/menus, form details and hidden features.
- Verify touch targets, scrolling, responsive at 360/375/390/402/430px, iPad landscape/portrait; Safari, Chrome and installed PWA.
- Run lint, typecheck, unit tests, build, and desktop before/after screenshot comparisons in a full checkout with dependencies.

## Verification limitations in this environment

The GitHub connector exposes repository contents but not a checked-out dependency tree or an authenticated browser session. A full Next.js lint/typecheck/build and authenticated responsive screenshots cannot be claimed here. Source-level invariants were checked for this navigation change. Further changes require the complete test matrix before declaring done.

## Dashboard follow-up implementation

- Mobile KPIs now use the selected dashboard range rather than querying a second fixed-today snapshot. This removes one dashboard query when the selected range is not today.
- Added gross profit and margin, low-stock product links, and recent orders with statuses in the mobile-only tree.
- The desktop dashboard component tree is unchanged; no backend business calculations were altered.
- Full visual/build regression remains unverified in this connector-only environment.
