# Mobile Web Completion Design

## Objective

Finish the remaining mobile-web UX alignment with the Flutter application without changing business rules, APIs, database schemas, desktop workflows, or role permissions.

The result must let a user complete daily operations on a 360–430px viewport without horizontal page scrolling, undersized controls, hidden primary actions, or desktop-only data tables.

## Scope and delivery order

### Batch 1 — Operational records and line editors

Replace remaining desktop-only tables with responsive renderers:

- Customer order history.
- Supplier purchase history.
- Purchase detail lines.
- Purchase creation and editing lines.
- Purchase-return creation lines.
- Internal-use lines.
- Stocktake lines where mobile editing still requires horizontal scrolling.

Desktop keeps the current table presentation. Mobile receives record cards or line-editor cards that expose the same data and actions.

Each mobile line editor must provide:

- Product identity and SKU at the top.
- Quantity, unit, price, discount, and amount in a readable vertical hierarchy.
- Inputs with a minimum 44px interactive height.
- A clearly labeled destructive action.
- Inline validation next to the affected input.
- Totals and submit actions after the line list, without covering focused fields.

### Batch 2 — Dashboard and reports

Complete responsive behavior for analytical surfaces:

- Date and report filters use horizontally scrollable chips or a compact disclosure panel.
- Metric values use tabular figures and do not truncate important amounts.
- Charts fit the viewport and retain readable labels.
- Report tables receive mobile cards for their primary dimensions and values.
- Secondary data remains available through progressive disclosure instead of horizontal page scrolling.

No report calculation or query changes are included.

### Batch 3 — Settings and configuration

Improve the settings shell and complex configuration pages:

- Mobile settings navigation becomes a compact section selector instead of a permanent split pane.
- Save actions remain reachable with a sticky bottom action area where forms are long.
- Inputs, toggles, template actions, and modal close controls meet the 44px target.
- Print and label editors preserve preview behavior while stacking editor and preview vertically on mobile.
- Loading, success, and validation feedback remain inline and do not rely on browser alerts.

Desktop settings navigation and multi-column editors remain unchanged.

### Batch 4 — Specialist screens and final audit

Finish remaining specialist routes:

- Project and service detail tables.
- Notifications.
- AI assistant shell.
- Tools and electrical-label utilities.
- F&B table management and kitchen-related dialogs.

Then perform a route-wide audit for:

- Horizontal page overflow at 360px.
- Controls smaller than 44px.
- Missing back navigation or primary actions.
- Sticky elements covering content.
- Missing empty, loading, or error states.
- Light and dark theme regressions.

## Component design

### Responsive record presentation

Data-heavy views use two explicit renderers:

- `lg:hidden` mobile cards.
- `hidden lg:block` desktop tables.

Business calculations and formatted values are prepared once before rendering. The mobile and desktop renderers consume the same typed record, preventing differences in totals, permissions, and status handling.

The implementation may extend existing mobile UI primitives with small focused components:

- A record card container.
- Label/value rows.
- A compact status header.
- A mobile action group.

These primitives must remain presentational. They must not own fetching, mutations, permissions, or business calculations.

### Mobile line editor

Purchase, return, stocktake, and internal-use forms retain their current state and mutation logic. Only the line presentation changes by breakpoint.

Each line is one semantic section with its product name as the accessible heading. Form controls keep their existing state handlers and validation constraints. Desktop tables remain the canonical dense editing view at large breakpoints.

### Sticky actions

Sticky action areas use `position: sticky`, safe-area bottom padding, and an opaque surface. They appear only where the existing submit action can otherwise leave the viewport during a long form. Sticky areas must not duplicate submissions or hide the final content.

## Responsive rules

- Target viewport range: 360px through 430px, with tablet behavior remaining fluid.
- No route may create horizontal page scrolling. Intentional horizontal scrolling is allowed only inside tab/chip carousels.
- Primary touch controls are at least 44×44px.
- Main content uses 12–16px mobile page padding.
- Long titles truncate only when the full value is available in adjacent detail content.
- Numeric values use tabular figures.
- Mobile cards use existing canvas, surface, border, radius, and semantic color tokens.
- Existing i18n keys are reused; new visible text must be added in both Vietnamese and English.

## State handling

- Empty states explain what is missing and identify the next useful action when one exists.
- Loading behavior continues to use the route’s existing mechanism; new async flows are not introduced.
- Mutation errors remain inline and preserve form state.
- Destructive actions keep existing confirmations and authorization checks.
- Role and industry gating must match existing server-side rules.

## Compatibility and non-goals

The following are explicitly out of scope:

- API, database, authentication, pricing, inventory, or payment logic changes.
- New Flutter functionality.
- Desktop visual redesign.
- New charting, UI, icon, or state-management dependencies.
- Replacing existing translation infrastructure.
- Adding routes that do not already have a working web surface.

## Verification

Each batch requires:

- Focused regression tests for any new shared responsive primitive or extracted formatter.
- Existing TypeScript unit suite.
- ESLint on changed files.
- Production Next.js build.
- Responsive source audit for remaining wide tables and undersized controls.

The final audit also checks representative routes at mobile width when an authenticated local session is available. If authentication or data prevents visual runtime inspection, that limitation must be reported without weakening the build and unit-test requirements.

## Acceptance criteria

The goal is complete when:

1. The scoped operational flows can be read and edited at 360px without horizontal page scrolling.
2. Dashboard, reports, settings, and specialist routes have an intentional mobile layout.
3. Primary and destructive actions remain reachable and meet the touch-target requirement.
4. Desktop layouts and all existing business behavior remain intact.
5. Vietnamese and English messages remain valid.
6. Relevant tests, lint, and production build pass.
7. The final implementation is committed and pushed to `origin/main`.
