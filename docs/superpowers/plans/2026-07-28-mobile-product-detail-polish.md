# Mobile Product Detail Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mobile web product-detail flow follow the Flutter product-detail hierarchy while preserving web data, actions, routes, permissions, and desktop layout.

**Architecture:** Keep `ProductDetailView` and its existing data/action handlers as the single product-detail implementation. Add mobile-only composition and responsive classes inside the existing components; desktop continues using the current tabbed detail layout. No new dependency, backend call, schema, or route is introduced.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, next-intl.

## Global Constraints

- Flutter remains the source of truth for mobile hierarchy and spacing.
- Mobile target is `< 768px`; desktop behavior at `>= 1024px` must remain unchanged.
- Preserve all product actions, query parameters, permission checks, translations, and server mutations.
- Tap targets remain at least `44 × 44px`.
- Do not add a UI dependency or hard-code a new color palette.

---

### Task 1: Native mobile product-detail hierarchy

**Files:**
- Modify: `src/app/(app)/products/[id]/page.tsx`
- Modify: `src/app/(app)/inventory/tabs/products-table.tsx`

**Interfaces:**
- Consumes: existing `ProductRow`, `ProductDetailView`, `ProductActionBar`, `Routes.productDetail()`, and existing next-intl keys.
- Produces: responsive product header, compact mobile product summary, readable metric surfaces, and non-scrolling primary action layout.

- [x] **Step 1: Characterize the current responsive gap**

Confirm from source that the mobile page header uses a `36px` back target, the detail information is a desktop grid collapsed to one column, and the action bar requires horizontal scrolling.

- [x] **Step 2: Implement the mobile page header**

Use a sticky surface header below `lg`, a `44px` back target, balanced title/subtitle text, and retain the current desktop header via responsive classes.

```tsx
<div className="sticky top-0 z-20 ... lg:static">
  <Link className="grid h-11 w-11 ... lg:h-9 lg:w-9" />
  <h1 className="line-clamp-2 ... lg:truncate" />
</div>
```

- [x] **Step 3: Implement the mobile information composition**

Keep the existing tabs and advanced panels, but make the main information tab follow the Flutter order: product identity and status, selling/cost/stock metrics, then grouped metadata and variants. Use responsive classes so the existing desktop grid remains intact.

```tsx
<div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
  <MobileProductMetric ... />
</div>
```

- [x] **Step 4: Replace mobile horizontal action scrolling**

On mobile, render copy and purchase as equal-width actions and More as a `44px` icon action. Keep Edit available and preserve the existing wrapped desktop toolbar.

```tsx
<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] gap-2 xl:flex">
```

- [x] **Step 5: Run focused verification**

Run:

```bash
bunx eslint 'src/app/(app)/products/[id]/page.tsx' 'src/app/(app)/inventory/tabs/products-table.tsx'
bun test tests/product-editor-navigation.test.ts tests/floating-menu-position.test.ts tests/product-stock-display.test.ts
bun run build
```

Expected: all focused tests pass, ESLint exits `0`, and production build exits `0`.

- [x] **Step 6: Inspect and publish the slice**

Run `git diff --check`, inspect only the planned files plus this plan, commit with `feat: polish mobile product detail`, and push to `origin/main` per `AGENTS.md`.
