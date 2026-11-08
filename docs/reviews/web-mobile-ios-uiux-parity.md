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

1. No backend, schema, catalog, IndexedDB or offline queue modifications; Service Worker security fix is separately documented below.
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

The GitHub connector exposes repository contents but not an authenticated browser session. GitHub Actions now runs Next route type generation, TypeScript, ESLint and scoped Bun regression tests on main; their status must be checked per commit. Production build, authenticated screen captures and 360–1440px responsive comparison have not been performed in this environment. Full browser/device testing remains mandatory before declaring parity complete.

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

## Reports native current-week period

- Mobile report period presets now offer Today / This Week / This Month / Custom, matching the week-based iOS report range; Monday-start week uses the same existing report queries with bounded start/end dates.
- Legacy 7d/30d/90d/last-month/year custom choices remain in the **unchanged Desktop period dropdown**. Mobile is a separate presentation of the same `ReportPeriod` state.
- No new aggregate query or report schema changes.

## POS iPhone native editable notes and project fields

- On mobile, the POS order-note and optional project-name text fields now use 16px fonts (Safari does not zoom on focus) and 44px minimum hit heights. Desktop retains its previous fonts, padding and sizes.
- Both inputs keep their existing state setters and document business logic intact.

## Expanded CI for Finance, Reports and POS edit fields

- Mobile parity CI now also runs Bun assertions on Cashbook native-style rows, current-week report filtering and POS note/project inputs, alongside earlier screens and PWA.

## Detail sheets — focus and iPhone safe areas

- `RowPreviewModal` is now keyboard-scoped to the topmost `aria-modal` sheet, so Escape does not accidentally close a background document sheet. Tab/Shift+Tab stays within the active dialog, focus is restored on dismissal, and background page scrolling is locked during its lifetime.
- Phone-sized modal bounds account for `safe-area-inset-top`; existing small/tablet/desktop modal widths and max-heights at `sm:` and above are retained. Existing footer still pads the iPhone bottom safe area.
- Added a render + pure Escape-policy regression test. Authenticated visual tests on mobile and desktop still required.

## POS quotation confirmation heading

- The native `POSCheckoutPricingSection.swift` distinguishes `Chi tiết báo giá` from `Chi tiết thanh toán`. Web Mobile now uses the same localized summary heading for quote drafts, including camera quotes, and the payment-specific heading for other draft types.
- Only a small `lg:hidden` heading was added to the existing settlement panel. Discount/VAT/shipping inputs, quote save action, document calculations and desktop layout stay unchanged.

## Native product editor toolbar and preserved web-only save actions

- Mobile product create/edit modal and full-screen editor expose **Cancel, centered title, Save** in the header like `NativeProductFormTabsShell`. Submits continue through existing React Hook Form/Zod and the original save intent.
- The three-button mobile footer is replaced by a collapsed `Save options` disclosure containing **Direct sale** and **Save & create another / similar / variant**; both actions remain available. The checkbox changes the existing registered form value without registering it twice.
- Original Desktop modal X, header `FormActions`, footer `FormActions`, spacing and save behavior stay under the same `lg:` breakpoint. UI confirmation in browser is still needed.

## Inventory filter full-screen native mobile presentation

- The shared Inventory filter now opens as a full-viewport sheet below the `lg` breakpoint, matching the iOS product filter screen instead of a narrow 460px slide-over. Desktop remains the original 460px side drawer at `lg`.
- Mobile sections use separate card surfaces, the scroll region remains independent from fixed title/footer, the title accounts for the top safe area, and footer Apply/Clear controls have 56px touch height plus bottom safe-area padding.
- Filter fields, preview count calculations, draft reset/apply URL parameters, network calls and nested picker behavior are unchanged. Visual/browser comparison remains outstanding.

## Product detail tabs and expanded verification

- Web Mobile product detail tabs now match `NativeProductDetailView.swift` `LumaScrollableTabBar` dimensions: **46px** high, **22px** spacing and a **3px** selected underline. All five native-equivalent tab destinations remain, with the previous Web Desktop 2px underline and gap retained under `lg:`.
- The GitHub Actions workflow now executes the new modal, quote, product editor, inventory filter and product detail regression tests in addition to existing TypeScript/ESLint.

## Dashboard reconnect notice — online/offline state

- Web Mobile now shows a native-style information notice if the device loses network access **while an already rendered dashboard is on screen**. It listens to browser online/offline events and cleans up both listeners; no refetch, polling, cache write, or duplicate provider was introduced.
- The label explicitly says existing displayed data **may be stale**. Unlike iOS's cached snapshot, this does not enable server-rendered dashboard cold launch offline. Desktop remains unchanged; offline PWA cold launch is still a documented limitation.

## Reports — native-style Mobile range filter sheet

- Mobile reports now expose a single accessible full-screen date-range selector, matching the native `NativeReportFilterView`: Today / Week / 7, 30, 90 days / This Month / Last Month / This Year / Custom. The active value remains visible in the trigger. The previously cramped four-chip row is removed from the Mobile page.
- Selecting a range is **draft-only** until Apply; Cancel does not change URLs, data or current report. Custom dates are validated before Apply. The selector uses the existing Next navigation and report period resolver, without additional data providers or background polling.
- Desktop still uses the existing drop-down (and original custom-date modal); mobile-only overlay uses the existing focus-trapping, safe-area-aware `RowPreviewModal`.

## Invoice filter panels — full-screen iPhone and safe-area control

- Orders, quotations, reservations, and returns now use a full-viewport mobile filtering sheet with an independent scroll region, keyboard-focus handling, safe-area header, and persistent action footer. This matches the native invoice filter presentation more closely while retaining the original 460px slide-over at `lg` desktop widths.
- All existing filter fields, date presets, entity pickers, debounced result-count queries, Cancel/Clear/Apply behavior, validation, and URL navigation remain untouched. The shared popup's search field uses 16px on iPhone to prevent Safari focus zoom; desktop retains 14px.
- Production screenshot comparisons (including a visible keyboard) are still required.

## Full-screen native customer and supplier creation on mobile

- Both partner-creation dialogs now use 100dvh full-screen Mobile/iPad sheets with safe-area top/bottom padding, independently scrolling forms and sticky title bar. The previous Desktop 760px maximum height, 672px width, padding and rounded card are preserved behind `lg:`.
- Save, Cancel, Zod/React Hook Form, address picker, create action and `onCreated` callback are unchanged. Close action now has localized accessible name.
- Native toolbar Save/Cancel arrangement and actual software-keyboard geometry remain to compare on a real phone.

## Customer and supplier native filter sheets

- Both partner list filters now use full screen on phones and retain the 460px drawer from `lg` desktop breakpoint; top and bottom safe areas are respected.
- Customer filter has the correct dialog role/title and its date/money controls use 16px on phones. Supplier debt selection retains its staged Apply/Reset action and independently scrolling content.
- Filter queries and business rules remain unchanged. Touch/keyboard screenshots are still outstanding.

## Product detail native summary — three visible metrics

- Mobile product information now shows the iOS-style three-column strip for price, cost and current stock. The former fourth minimum-stock tile is moved into the Mobile information list, preserving it while matching native hierarchy.
- Desktop price/cost/stock/minimum stock rows and product calculations remain unchanged. Metric amounts wrap on small screens to avoid clipping.

## POS — mobile line price editor bottom sheet

- The POS price/discount editor now opens as an iPhone bottom sheet with independent scrolling, bottom safe-area padding, and a 48px `Done` button. The same existing price book, unit price, discount, free-item and computed sell-price controls are reused; **price updates still follow the existing immediate-change handler** and Done only dismisses the sheet.
- Prevent automatic keyboard opening when the mobile sheet appears, while preserving desktop focus-on-open via a desktop-only media check. Desktop retains the centered 400px modal, padding, and styling behind `lg:`.
- Requires a real iPhone keyboard/Viewport visual test; code and Bun source assertions alone cannot establish keyboard-free occlusion.

## Partner creation — sticky mobile actions

- Customer and supplier creation forms now support opt-in sticky bottom Save/Cancel controls in full-screen mobile dialogs. Long forms keep submission and cancellation accessible without scrolling all the way down.
- When embedded elsewhere, the option defaults off; the original Desktop button arrangement remains via `lg:`. RHF validation, consent, address, and create semantics stay unchanged.

## POS line-item note — iPhone keyboard/typography

- The mobile-only cart line note now uses 16px readable type, a 44px minimum touch area, and generous inline padding. It keeps the existing draft note `setLineNote` handler and automatic row-height measurement; the Desktop note field is a separate unchanged `lg:flex` tree.

## POS mobile checkout footer responsiveness

- The POS cart action row now uses a two-column mobile grid: Hold/Print are compact secondary actions, while the primary Save/Confirm/Pay CTA spans the full width. At `lg` the original single-row flex arrangement is restored.
- The primary total/label remains visible (rather than hiding monetary information), has a 48px minimum phone hit target and allows wrapping when the amount is long. Print, Hold and submit handlers, draft guards, price calculations, and desktop behavior remain unchanged.
- Requires an iPhone 360/375px real screenshot and keyboard-visible state to complete visual verification.

## POS amounts on iPhone (numeric input font)

- Discount, VAT, shipping, paid-amount and line-price inputs now use 16px mobile font and retain prior 14px desktop text at `lg`. This prevents Safari's common focus zoom behavior without changing numeric parsing, values, VAT logic, stock, payments or pricing confirmation.

## Product entry and gallery safe area

- Full-height product create/edit/detail modal frames now respect the iPhone's top safe inset; tablet/desktop `sm:` geometry remains unchanged.
- Full-screen product-image previews offset Close from the Dynamic Island/status area and the image caption from the bottom home indicator. Original `sm:` offsets remain for larger screens.
- The data source and image navigation behaviors are unchanged; visual PWA/Safari verification is still required.

## Settings — native grouped navigation for iPhone

- The Mobile Settings root now shows all existing Web settings grouped in a native-style list of 56px+ rows with leading icons and chevrons. Tapping an item opens its existing settings form; a back button returns to the grouped list, matching `NativeSettingsRootView` in iOS while preserving Web-only sections.
- Existing settings forms, permissions, default sort logic, lazy data queries, save handlers, and state management were not duplicated. The Desktop (from `md`) retains its exact prior sidebar and settings content; `initialTab` deep links open the requested section directly.
- Browser back swipe and authenticated iPhone screenshots still require manual verification. No extra catalog provider or API call was added.

- Settings root list reserves the fixed Mobile app tab-bar height in its bottom padding, including the home-indicator safe area, so the last settings option remains tappable.

## POS web-only quick sale line — safe mobile sheet

- The Web-only quick-line creator keeps its existing name/SKU/unit/price form and validation but now uses a mobile bottom sheet up to the `lg` breakpoint, with iPhone safe-area padding and independent scrolling. Desktop retains its previous centered 512px dialog.
- Auto focus remains on Desktop only, preventing premature mobile Safari keyboard occlusion on opening. SKU generation, add callbacks, error handling and submit rules are unchanged.
