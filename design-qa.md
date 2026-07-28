# Mobile Web ↔ Flutter Design QA

**Findings**

- No actionable P0, P1, or P2 findings remain after the implementation iterations below.
- [P3] The Flutter source includes iOS simulator chrome, a native status bar, and a home indicator while the mobile web capture contains only the browser viewport. These are host-environment differences, not app-owned fidelity defects.
- [P3] A few icon glyphs differ slightly because the web app uses the existing Lucide icon family while Flutter uses its native icon set. Size, stroke weight, color, active state, and meaning remain consistent.

**Comparison Target**

- Source visual truth: `/Users/cvthien/project/LumaPOS/.codex/audits/mobile-ui-2026-07-10/02-pos-empty.png` through `06-more.png`.
- Source pixels: `363 × 841` for each Flutter simulator capture.
- Implementation screenshots:
  - `/Users/cvthien/project/LumaPOS/luma-pos-web/.codex/visual-qa/mobile-native-alignment/dashboard-393.png`
  - `/Users/cvthien/project/LumaPOS/luma-pos-web/.codex/visual-qa/mobile-native-alignment/inventory-393-final-v3.png`
  - `/Users/cvthien/project/LumaPOS/luma-pos-web/.codex/visual-qa/mobile-native-alignment/orders-393.png`
  - `/Users/cvthien/project/LumaPOS/luma-pos-web/.codex/visual-qa/mobile-native-alignment/pos-393-final.png`
  - `/Users/cvthien/project/LumaPOS/luma-pos-web/.codex/visual-qa/mobile-native-alignment/more-393-final.png`
- Implementation pixels and CSS viewport: `393 × 852`; device pixel ratio `1`.
- Density normalization: no resampling was applied. Each `363 × 841` framed Flutter source and `393 × 852` unframed web capture was placed at native pixel density in a single labelled comparison canvas. App-owned regions were judged independently of simulator chrome.
- State: authenticated owner, Vietnamese, light theme; Dashboard, Inventory/Products, Orders, POS empty, POS with a selected item, More, and desktop Dashboard.
- Full-view comparison evidence: `/Users/cvthien/project/LumaPOS/luma-pos-web/.codex/visual-qa/mobile-native-alignment/comparisons/`.
- Focused evidence: `pos-cart-393-final.png` was used to verify the selected-line controls and sticky checkout CTA; `dashboard-1440.png` was used for the desktop regression check. Additional crops were unnecessary because the full captures preserve readable text and controls at 1×.

**Required Fidelity Surfaces**

- Fonts and typography: hierarchy, weight, compact labels, line height, truncation, and Vietnamese wrapping follow the Flutter reference. Long product names and SKU metadata remain readable without horizontal overflow.
- Spacing and layout rhythm: top bars, underlined tabs, section spacing, list density, grouped settings rows, persistent bottom navigation, and sticky POS CTA now follow the native composition. `document.body.scrollWidth` equals the `393px` viewport on tested screens.
- Colors and visual tokens: warm canvas, white surfaces, teal primary states, subdued metadata, semantic badges, and soft icon backgrounds map to existing LumaPOS tokens and maintain contrast.
- Image quality and asset fidelity: real product thumbnails are preserved where available. The source contains no required illustrative or photographic hero asset that is missing from the web implementation.
- Copy and content: mobile labels are concise and app-specific; Vietnamese and English message catalogs parse successfully. Dynamic counts and commercial data differ from the static Flutter capture by design.
- Icons and interaction states: navigation active states, links, filters, empty states, disabled checkout, populated checkout, and tap targets were visually and interactively checked.
- Accessibility: primary navigation is semantic and labelled, active links expose `aria-current`, controls are keyboard focus-visible, decorative icons are hidden from assistive technology where appropriate, and primary tap targets are at least approximately 44px.

**Comparison History**

1. [P1] POS checkout button overlapped the persistent bottom navigation and could route a tap to Inventory.
   - Fix: moved the CTA above the safe-area navigation, raised its stacking order, and retested Search → select product → Checkout.
   - Post-fix evidence: `pos-cart-393-final.png`; checkout opens the cart state and no longer triggers bottom navigation.
2. [P2] A selected POS line retained the wide desktop row layout at `393px`, causing severe wrapping and horizontal compression.
   - Fix: added a dedicated mobile line-item composition with stacked identity, unit/quantity, price, total, and note controls.
   - Post-fix evidence: `pos-cart-393-final.png`; viewport width and document width both measure `393px`.
3. [P2] Inventory mobile rows used generic cards with checkboxes and three metric columns, unlike the compact Flutter product list.
   - Fix: removed mobile-first bulk controls from the default state, reduced each row to thumbnail/name/SKU/price/stock, and grouped rows into a flat divided list.
   - Post-fix evidence: `inventory-393-final-v3.png` and `comparisons/inventory-compare.png`.
4. [P2] More rendered every destination as a separate elevated card, producing substantially different density from the Flutter grouped settings list.
   - Fix: grouped rows by section inside single divided surfaces while preserving semantic links and tap targets.
   - Post-fix evidence: `more-393-final.png` and `comparisons/more-compare.png`.

**Primary Interactions Tested**

- Bottom navigation routes: Dashboard, POS, Inventory, Orders, More.
- Inventory search/filter affordances and product-row opening surface.
- Orders status tabs and collapsed advanced filters.
- POS product search, result selection, cart line rendering, empty state, disabled checkout, and transition to checkout/cart.
- Desktop Dashboard at `1440 × 900`; mobile bottom navigation is hidden and no horizontal overflow was detected.
- Browser console: no runtime errors observed. The initial Next.js smooth-scroll warning was resolved by declaring `data-scroll-behavior="smooth"` on the root element.

**Validation Notes**

- Production build passed, including Next.js compilation and TypeScript checking.
- ESLint passed for every changed TypeScript/JavaScript file. The unscoped repository lint remained CPU-bound without output for several minutes and was stopped after the scoped clean run.
- The focused service-worker, product-navigation, and POS cart tests passed (`7/7`).
- The complete existing suite reported `163` passing and `22` infrastructure failures unrelated to this UI change. The failures require unavailable test prerequisites (`DATABASE_URL`, Supabase `auth.refresh_tokens`, or Next.js `AsyncLocalStorage` test context).

**Implementation Checklist**

- [x] Native-style mobile shell and five-tab navigation.
- [x] Dashboard mobile KPI and action hierarchy.
- [x] Inventory compact list, native tabs, filters, and floating create action.
- [x] Orders mobile filters and readable order list.
- [x] POS empty, selected-item, and checkout states.
- [x] Grouped More/settings destination page.
- [x] PWA naming, colors, service-worker cache revision, focus states, and safe areas.
- [x] Mobile and desktop browser validation.

**Follow-up Polish**

- If exact glyph parity becomes a product requirement, export and share the Flutter icon assets instead of replacing the established web icon system piecemeal.
- Device-specific iOS status-bar and home-indicator treatment should remain owned by the installed PWA/browser shell.

final result: passed
