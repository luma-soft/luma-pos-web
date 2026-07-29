# Mobile Web Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete every remaining mobile-web UX surface in the approved four-batch sequence while preserving desktop behavior and all business logic.

**Architecture:** Add small presentational mobile record primitives to `mobile-ui.tsx`, then give each data-heavy route an explicit mobile renderer while retaining its existing desktop table. Form state, mutations, permissions, calculations, and fetching remain in their current owners; responsive components consume the same typed records and callbacks.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, next-intl, Bun test, ESLint.

## Global Constraints

- Target viewport range is 360px through 430px.
- No route may create horizontal page scrolling; only tab and filter-chip carousels may scroll horizontally.
- Primary touch controls must be at least 44×44px.
- Do not change APIs, database schemas, authentication, permissions, prices, inventory calculations, payment logic, or desktop workflows.
- Do not add charting, UI, icon, or state-management dependencies.
- New visible text must exist in both `messages/vi.json` and `messages/en.json`.
- Keep current server-side role and industry gating.
- Run the TypeScript unit suite, targeted ESLint, and `bun run build` before completion.

---

### Task 1: Shared mobile record primitives

**Files:**
- Modify: `src/components/mobile-ui.tsx`
- Create: `tests/mobile-record-card.test.tsx`

**Interfaces:**
- Consumes: existing `cn()` helper and React nodes.
- Produces:
  - `MobileRecordCard(props: { title: React.ReactNode; subtitle?: React.ReactNode; status?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode; className?: string }): JSX.Element`
  - `MobileRecordField(props: { label: React.ReactNode; value: React.ReactNode; tone?: "neutral" | "success" | "warning" | "danger"; className?: string }): JSX.Element`
  - `MobileFormLineCard(props: { title: React.ReactNode; subtitle?: React.ReactNode; amount?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }): JSX.Element`

- [x] **Step 1: Write the failing semantic-render test**

```tsx
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MobileRecordCard, MobileRecordField } from "@/components/mobile-ui";

describe("MobileRecordCard", () => {
  test("renders a mobile-only semantic record with status and fields", () => {
    const html = renderToStaticMarkup(
      <MobileRecordCard title="PN-001" subtitle="28/07/2026" status="Đã nhận">
        <MobileRecordField label="Tổng tiền" value="1.250.000 ₫" tone="success" />
      </MobileRecordCard>,
    );
    expect(html).toContain("<article");
    expect(html).toContain("lg:hidden");
    expect(html).toContain("<dt");
    expect(html).toContain("<dd");
    expect(html).toContain("1.250.000 ₫");
  });
});
```

- [x] **Step 2: Run the focused test and confirm the missing exports fail**

Run: `bun test tests/mobile-record-card.test.tsx`

Expected: FAIL because `MobileRecordCard` and `MobileRecordField` are not exported.

- [x] **Step 3: Implement the presentational primitives**

```tsx
export function MobileRecordCard({ title, subtitle, status, children, actions, className }: MobileRecordCardProps) {
  return (
    <article className={cn("rounded-2xl border border-border bg-surface p-3 shadow-e1 lg:hidden", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-black">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate text-xs font-medium text-slate-400">{subtitle}</p>}
        </div>
        {status && <div className="shrink-0">{status}</div>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">{children}</dl>
      {actions && <div className="mt-3 flex min-h-11 items-center gap-2 border-t border-border-soft pt-2">{actions}</div>}
    </article>
  );
}
```

Implement `MobileRecordField` with `<dt>` and `<dd>` and tabular figures. Implement `MobileFormLineCard` as a mobile-only `<section>` whose body is not a `<dl>` so it can contain form controls.

- [x] **Step 4: Run focused tests**

Run: `bun test tests/mobile-record-card.test.tsx tests/mobile-detail-header.test.tsx`

Expected: all tests PASS.

- [x] **Step 5: Commit**

```bash
git add src/components/mobile-ui.tsx tests/mobile-record-card.test.tsx
git commit -m "feat: add mobile record card primitives"
```

---

### Task 2: Customer, supplier, and purchase detail cards

**Files:**
- Modify: `src/app/(app)/customers/[id]/page.tsx`
- Modify: `src/app/(app)/suppliers/[id]/supplier-detail.tsx`
- Modify: `src/app/(app)/purchases/[id]/page.tsx`
- Modify: `messages/vi.json`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: `MobileRecordCard`, `MobileRecordField` from Task 1; existing badges, links, formatters, and typed rows.
- Produces: mobile history/detail renderers with desktop tables unchanged.

- [x] **Step 1: Add mobile cards before each desktop table**

For customer orders, render the same `remaining` calculation and existing status components:

```tsx
<div className="space-y-2 p-3 lg:hidden">
  {customer.orders.map((order) => {
    const remaining = Number(order.total) - Number(order.amountPaid);
    return (
      <MobileRecordCard
        key={order.id}
        title={<OrderDetailLink orderId={order.id}>{order.code}</OrderDetailLink>}
        subtitle={formatDate(order.createdAt)}
        status={<OrderStatusBadge status={order.status} />}
      >
        <MobileRecordField label={t("orders.cols.total")} value={formatCurrency(Number(order.total))} />
        <MobileRecordField
          label={t("orders.cols.remaining")}
          value={remaining > 0 && order.status !== "cancelled" ? formatCurrency(remaining) : "—"}
          tone={remaining > 0 && order.status !== "cancelled" ? "danger" : "neutral"}
        />
        <MobileRecordField label={t("orders.cols.project")} value={order.projectName ?? "—"} />
        <MobileRecordField label={t("orders.cols.payment")} value={<PaymentStatusBadge status={order.paymentStatus} />} />
      </MobileRecordCard>
    );
  })}
</div>
```

Add equivalent supplier purchase cards and purchase item cards. Purchase item cards show SKU/product, quantity/unit, unit cost, discount, and line total.

- [x] **Step 2: Restrict the existing tables to desktop**

Apply `hidden lg:block` to the table wrappers, not the surrounding section headers or empty state. Ensure no mobile renderer is duplicated when the collection is empty.

- [x] **Step 3: Make mobile action rows touch-safe**

Purchase print, copy, edit, and cancel actions must have `min-h-11`, visible focus rings, and remain in their existing horizontal action scroller.

- [x] **Step 4: Validate translations and affected pages**

Run:

```bash
node -e 'for (const locale of ["vi","en"]) JSON.parse(require("fs").readFileSync(`messages/${locale}.json`))'
bunx eslint 'src/app/(app)/customers/[id]/page.tsx' 'src/app/(app)/suppliers/[id]/supplier-detail.tsx' 'src/app/(app)/purchases/[id]/page.tsx'
```

Expected: JSON parses; ESLint reports zero errors.

- [x] **Step 5: Commit**

```bash
git add messages src/app/'(app)'/customers src/app/'(app)'/suppliers src/app/'(app)'/purchases/'[id]'
git commit -m "feat: add mobile cards to partner and purchase details"
```

---

### Task 3: Mobile operational line editors

**Files:**
- Modify: `src/app/(app)/purchases/new/purchase-form.tsx`
- Modify: `src/app/(app)/purchase-returns/new/purchase-return-form.tsx`
- Modify: `src/app/(app)/inventory/internal-use-form.tsx`
- Modify: `src/app/(app)/stocktakes/new/stocktake-form.tsx`

**Interfaces:**
- Consumes: `MobileFormLineCard` from Task 1 and the existing form-local `patch`, remove, unit-change, validation, and total functions.
- Produces: form-equivalent mobile card editors; desktop tables keep current controls.

- [x] **Step 1: Add purchase line cards using existing handlers**

```tsx
<div className="space-y-2 lg:hidden">
  {lines.map((line) => (
    <MobileFormLineCard
      key={line.productId}
      title={line.name}
      subtitle={line.sku}
      amount={formatCurrency(lineTotal(line))}
      actions={(
        <Button
          type="button"
          variant="ghost"
          onClick={() => setLines((current) => current.filter((item) => item.productId !== line.productId))}
          className="min-h-11 text-er"
        >
          <Trash2 className="h-4 w-4" />{t("common.delete")}
        </Button>
      )}
    >
      <div className="grid grid-cols-2 gap-3">
        <Select
          value={line.unitName}
          onChange={(event) => changeUnit(line.productId, event.target.value)}
          className="h-11"
          options={[
            { value: line.baseUnit, label: line.baseUnit },
            ...line.units.map((unit) => ({ value: unit.unitName, label: `${unit.unitName} (×${unit.multiplier})` })),
          ]}
        />
        <QuantityInput value={line.quantity} onChange={(quantity) => patch(line.productId, { quantity })} className="min-h-11" />
        <MoneyInput value={line.unitCost} onChange={(value) => patch(line.productId, { unitCost: value ?? 0 })} className="h-11" />
        <NumberInput value={line.discInput} onChange={(value) => patch(line.productId, { discInput: value ?? 0 })} className="h-11" />
      </div>
    </MobileFormLineCard>
  ))}
</div>
```

Use the exact existing unit options and discount-mode controls rather than introducing a second calculation path.

- [x] **Step 2: Add purchase-return cards**

Expose warehouse stock, return quantity with the existing `max`, original cost, return cost, line total, and delete action. Preserve the current `overStock` error styling and show the error adjacent to quantity.

- [x] **Step 3: Add internal-use and stocktake cards**

Internal use shows product/SKU, available stock, quantity, unit, and note/reason fields already supported by the form. Stocktake shows system quantity, counted quantity, variance, and the current save/balance behavior.

- [x] **Step 4: Hide desktop line tables below `lg`**

Wrap each existing wide table with `hidden lg:block`; mobile cards use `lg:hidden`. Keep search results, side summary, form errors, and mutation buttons shared.

- [x] **Step 5: Add safe-area spacing to submit sections**

Use `pb-[calc(env(safe-area-inset-bottom)+0.75rem)]` and `sticky bottom-0` only on the mobile submit container. Do not create a second form or second submit handler.

- [x] **Step 6: Verify forms**

Run:

```bash
bun test tests/purchase-batch-contract.test.ts tests/purchase-batch-policy.test.ts tests/internal-use-authorization.test.ts tests/quantity-input.test.ts
bunx eslint 'src/app/(app)/purchases/new/purchase-form.tsx' 'src/app/(app)/purchase-returns/new/purchase-return-form.tsx' 'src/app/(app)/inventory/internal-use-form.tsx' 'src/app/(app)/stocktakes/new/stocktake-form.tsx'
```

Expected: tests PASS; ESLint has zero errors.

- [x] **Step 7: Commit**

```bash
git add src/app/'(app)'/purchases/new src/app/'(app)'/purchase-returns/new src/app/'(app)'/inventory/internal-use-form.tsx src/app/'(app)'/stocktakes/new
git commit -m "feat: add mobile operational line editors"
```

---

### Task 4: Reports mobile cards and filters

**Files:**
- Modify: `src/app/(app)/reports/page.tsx`
- Modify: `src/app/(app)/reports/report-detail-tables.tsx`
- Modify: `src/app/(app)/reports/report-invoices-table.tsx`
- Modify: `src/app/(app)/reports/report-period-filter.tsx`

**Interfaces:**
- Consumes: existing `DataTableShell.renderMobileRow`, typed report rows, formatters, and report filters.
- Produces: mobile rows for invoice, product, customer, and employee reports; compact mobile filter header.

- [x] **Step 1: Add `renderMobileRow` to every report table**

For products:

```tsx
renderMobileRow={({ row }) => (
  <div className="p-3">
    <div className="truncate text-sm font-black">{row.productName}</div>
    <dl className="mt-3 grid grid-cols-2 gap-2">
      <MobileRecordField label={t("reports.qtySold")} value={`${formatNumber(Number(row.qtySold))} ${row.baseUnit}`} />
      <MobileRecordField label={t("reports.revenue")} value={formatCurrency(Number(row.revenue))} />
      <MobileRecordField
        label={t("reports.grossProfit")}
        value={formatCurrency(Number(row.profit))}
        tone={Number(row.profit) >= 0 ? "success" : "danger"}
        className="col-span-2"
      />
    </dl>
  </div>
)}
```

Add equivalent customer and employee mobile rows. Keep the existing invoice mobile renderer and align its spacing and touch targets with the new primitives.

- [x] **Step 2: Make the report header native-mobile**

Use `MobileTopBar` for the mobile title/subtitle and retain the current sticky desktop header under `hidden lg:block`. Keep `GroupTabs` edge-to-edge on mobile and move `ReportPeriodFilter` into a compact disclosure when custom dates are not open.

- [x] **Step 3: Improve overview metrics and chart**

Prevent amount truncation by using `break-words` and `text-[clamp(1rem,5vw,1.35rem)]`. Give chart bars a minimum 32px hit area with an accessible `aria-label` containing date and amount.

- [x] **Step 4: Verify report UI**

Run:

```bash
bun test tests/dashboard-financials.test.ts tests/mobile-finance-summary.test.ts
bunx eslint 'src/app/(app)/reports/page.tsx' 'src/app/(app)/reports/report-detail-tables.tsx' 'src/app/(app)/reports/report-invoices-table.tsx' 'src/app/(app)/reports/report-period-filter.tsx'
```

Expected: tests PASS; ESLint has zero errors.

- [x] **Step 5: Commit**

```bash
git add src/app/'(app)'/reports
git commit -m "feat: complete mobile reports layout"
```

---

### Task 5: Dashboard mobile trend context

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`
- Modify: `messages/vi.json`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: existing `mobileData`, `data.revenueByDay`, `MobileMetricTile`, and dashboard range query.
- Produces: an intentional mobile trend section without changing dashboard data queries.

- [x] **Step 1: Add mobile range chips**

Render the existing `RANGES` as a snap-scrolling chip row below `MobileTopBar`, using the same `?range=` URLs. The active chip uses the primary surface; every chip has `min-h-11`.

- [x] **Step 2: Add a compact revenue trend section**

Use `data.revenueByDay` and `maxDay` to render the selected range. Each bar is at least 28px wide and has an `aria-label` with its date and formatted revenue. Do not add a chart dependency.

- [x] **Step 3: Keep today attention metrics stable**

Continue using `mobileData` for the operational “today” cards. Label the new chart as selected-range context so the two time scopes are not ambiguous.

- [x] **Step 4: Validate translations and dashboard tests**

Run:

```bash
node -e 'for (const locale of ["vi","en"]) JSON.parse(require("fs").readFileSync(`messages/${locale}.json`))'
bun test tests/dashboard-financials.test.ts
bunx eslint 'src/app/(app)/dashboard/page.tsx'
```

Expected: JSON parses; tests pass; ESLint has zero errors.

- [x] **Step 5: Commit**

```bash
git add messages src/app/'(app)'/dashboard/page.tsx
git commit -m "feat: add mobile dashboard trend context"
```

---

### Task 6: Settings and template editors

**Files:**
- Modify: `src/app/(app)/settings/settings-client.tsx`
- Modify: `src/app/(app)/settings/print/print-settings-form.tsx`
- Modify: `src/app/(app)/settings/labels/label-settings-form.tsx`
- Modify: `src/components/mobile-ui.tsx`

**Interfaces:**
- Consumes: existing `active`, `pick`, `NAV`, `SEC_META`, current save mutations, and template preview components.
- Produces: mobile settings top bar/section picker, vertically stacked template editors, safe sticky actions.

- [x] **Step 1: Replace the bare mobile selector with a settings top bar**

Use `MobileTopBar` with the active section title and a 44px section-select control in `bottom`. Keep the `md:flex` desktop navigation unchanged.

- [x] **Step 2: Normalize mobile content spacing**

Change the content wrapper to `px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+3rem)] md:px-7 md:py-6`. Remove the duplicate mobile breadcrumb when the title is already in `MobileTopBar`.

- [x] **Step 3: Make section actions mobile-safe**

For each settings card touched by the active section, ensure inputs and toggles are at least 44px high. Convert multi-button footer rows to `sticky bottom-0` only below `md`, using the existing save callbacks and loading flags.

- [x] **Step 4: Stack print and label editor workspaces**

Use a single-column mobile layout with editor first and preview second; retain the existing `xl:grid-cols-*` desktop layout. Template list controls, add, duplicate, default, hide, and save actions receive 44px targets and accessible labels.

- [x] **Step 5: Verify settings**

Run:

```bash
bun test tests/mobile-settings-access.test.ts tests/notification-settings.test.ts tests/staff-settings-mutation.test.ts
bunx eslint 'src/app/(app)/settings/settings-client.tsx' 'src/app/(app)/settings/print/print-settings-form.tsx' 'src/app/(app)/settings/labels/label-settings-form.tsx' src/components/mobile-ui.tsx
```

Expected: tests PASS; ESLint has zero errors, aside from documented pre-existing compiler warnings if emitted.

- [x] **Step 6: Commit**

```bash
git add src/app/'(app)'/settings src/components/mobile-ui.tsx
git commit -m "feat: polish mobile settings workflows"
```

---

### Task 7: Project/service and notification mobile records

**Files:**
- Modify: `src/app/(app)/projects/[id]/page.tsx`
- Modify: `src/app/(app)/projects/[id]/project-service-tabs.tsx`
- Modify: `src/app/(app)/notifications/page.tsx`
- Modify: `src/app/(app)/notifications/notifications-table.tsx`
- Modify: `messages/vi.json`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: mobile record primitives, existing project domain rows, `DataTableShell.renderMobileRow`, existing audit scrubbing and detail renderer.
- Produces: mobile project/service timelines and notification cards with no audit-data exposure changes.

- [x] **Step 1: Convert project/service wide tables**

Add `lg:hidden` cards for service materials, costs, installed assets, maintenance, warranty, and non-service order history. Reuse each row’s existing status actions and formatters; retain desktop tables under `hidden lg:block`.

- [x] **Step 2: Improve service tabs**

Keep the horizontal tab carousel but give each tab `min-h-11`, `snap-start`, visible focus rings, and `aria-selected`.

- [x] **Step 3: Localize the notification header and filter labels**

Replace hard-coded Vietnamese header, subtitle, filter labels, and status labels with paired `notifications.*` keys in both locales.

- [x] **Step 4: Add a notification mobile renderer**

```tsx
renderMobileRow={({ row }) => (
  <div className="p-3">
    <ActivityCell row={row} />
    <div className="mt-3 flex items-center justify-between gap-2">
      <span className={cn("rounded-full px-2 py-1 text-xs font-bold", sourceTone(row.source))}>{row.source}</span>
      <span className={cn("rounded-full px-2 py-1 text-xs font-bold", toneFor(row.status))}>{statusText(row.status, t)}</span>
    </div>
    <div className="mt-2 text-xs text-slate-400">{row.actorNameSnapshot ?? row.actorId ?? t("notifications.systemActor")} · {formatDate(row.createdAt)}</div>
  </div>
)}
```

Keep `ExpandedAudit` as the single detail renderer so secret redaction and record links remain unchanged.

- [x] **Step 5: Verify service and notification contracts**

Run:

```bash
bun test tests/service-domain.test.ts tests/notification-settings.test.ts tests/notification-channels.test.ts
node -e 'for (const locale of ["vi","en"]) JSON.parse(require("fs").readFileSync(`messages/${locale}.json`))'
bunx eslint 'src/app/(app)/projects/[id]/page.tsx' 'src/app/(app)/projects/[id]/project-service-tabs.tsx' 'src/app/(app)/notifications/page.tsx' 'src/app/(app)/notifications/notifications-table.tsx'
```

Expected: tests and JSON parse PASS; ESLint has zero errors.

- [x] **Step 6: Commit**

```bash
git add messages src/app/'(app)'/projects/'[id]' src/app/'(app)'/notifications
git commit -m "feat: polish mobile service and notification views"
```

---

### Task 8: AI, tools, F&B, and remaining specialist controls

**Files:**
- Modify: `src/app/(app)/ai/page.tsx`
- Modify: `src/components/ai-assistant-launcher.tsx`
- Modify: `src/app/(app)/tools/tile-calculator.tsx`
- Modify: `src/app/(app)/tools/tool-page-header.tsx`
- Modify: `src/app/(app)/tools/electrical-labels/electrical-labels-client.tsx`
- Modify: `src/app/(app)/tables/tables-floor.tsx`
- Modify: `src/app/(app)/tables/modifiers-manage.tsx`
- Modify: `src/app/(app)/tables/[id]/table-order.tsx`
- Modify: `src/app/(app)/kds/page.tsx`

**Interfaces:**
- Consumes: existing AI workspace, tool calculations, table mutations, modifier forms, and kitchen data.
- Produces: safe mobile shells and touch targets; no new calculations or mutations.

- [x] **Step 1: Make AI workspace viewport-safe**

Use `min-h-0 flex-1` for the message viewport, keep the composer above `env(safe-area-inset-bottom)`, ensure attachment/remove/send controls are 44px, and prevent the app bottom nav from covering the composer.

- [x] **Step 2: Normalize tool headers and forms**

Use `MobileTopBar`/`MobileDetailHeader` on tools, stack input/result columns below `lg`, give calculator and electrical-label controls 44px height, and keep print layouts unchanged under `print:*`.

- [x] **Step 3: Finish F&B dialogs**

Ensure floor selection, modifier editor, product option dialog, close, merge, move, kitchen, and checkout controls meet 44px. Keep table cards in a two-column mobile grid only when 360px has at least 12px gutters; otherwise use one column.

- [x] **Step 4: Make KDS responsive**

Keep ticket actions reachable without horizontal scrolling, use one ticket column at mobile width, and retain the existing status mutation callbacks.

- [x] **Step 5: Verify specialist behavior**

Run:

```bash
bun test tests/table-cart-authority.test.ts tests/tile-calculator.test.ts tests/mobile-timeout.test.ts
bunx eslint 'src/app/(app)/ai/page.tsx' src/components/ai-assistant-launcher.tsx 'src/app/(app)/tools/**/*.tsx' 'src/app/(app)/tables/**/*.tsx' 'src/app/(app)/kds/page.tsx'
```

Expected: tests PASS; ESLint has zero errors.

- [x] **Step 6: Commit**

```bash
git add src/app/'(app)'/ai src/components/ai-assistant-launcher.tsx src/app/'(app)'/tools src/app/'(app)'/tables src/app/'(app)'/kds
git commit -m "feat: finish mobile specialist screens"
```

---

### Task 9: Route-wide responsive audit and final verification

**Files:**
- Modify only files identified by the audit.
- Modify: `docs/superpowers/plans/2026-07-28-mobile-web-completion.md`

**Interfaces:**
- Consumes: all completed tasks and the approved spec.
- Produces: completion evidence, checked plan, clean worktree, pushed `origin/main`.

- [x] **Step 1: Run source audits**

Run:

```bash
rg -n 'min-w-\\[[5-9][0-9]{2}px\\]|min-w-\\[1[0-9]{3}px\\]' 'src/app/(app)' --glob '*.tsx'
rg -n 'className=\"[^\"]*(p-1|p-1\\.5|h-8|w-8)[^\"]*\"' 'src/app/(app)' --glob '*.tsx'
rg -n 'overflow-x-auto' 'src/app/(app)' --glob '*.tsx'
```

Classify every result as desktop-only, intentional chip/tab scrolling, print-only, or unresolved mobile overflow. Fix every unresolved result with an explicit mobile renderer or touch-safe class.

- [x] **Step 2: Run responsive browser inspection when authentication is available**

Inspect dashboard, reports, settings, customer detail, supplier detail, purchase detail/create, purchase return, stocktake, project detail, notifications, AI, tools, tables, and KDS at 360×800 and 430×932. Verify page overflow, sticky overlap, focus visibility, empty states, and both themes.

- [x] **Step 3: Run the TypeScript unit suite**

Run: `bun test tests/*.test.ts tests/*.test.tsx`

Expected: all TypeScript tests PASS.

- [x] **Step 4: Run JSON validation and targeted/full lint**

Run:

```bash
node -e 'for (const locale of ["vi","en"]) JSON.parse(require("fs").readFileSync(`messages/${locale}.json`))'
bun run lint
```

Expected: JSON parses; lint exits zero. If full lint stalls due repository scale, run ESLint on every changed TS/TSX file and report the full-lint limitation.

- [x] **Step 5: Run the production build**

Run: `bun run build`

Expected: Next.js compile, TypeScript, page-data collection, and static generation all complete successfully.

- [x] **Step 6: Review the complete diff and plan coverage**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~8..HEAD
```

Check every acceptance criterion in `docs/superpowers/specs/2026-07-28-mobile-web-completion-design.md` against current files and fresh verification output.

- [x] **Step 7: Mark this plan complete and commit audit fixes**

Change every completed checkbox in this plan to `[x]`, then run:

```bash
git add src messages tests docs/superpowers/plans/2026-07-28-mobile-web-completion.md
git commit -m "chore: complete mobile web responsive audit"
```

- [ ] **Step 8: Push and verify remote state**

Run:

```bash
git push origin main
git status --short
git log -1 --oneline --decorate
```

Expected: clean status; `HEAD`, `main`, and `origin/main` point to the final commit.
