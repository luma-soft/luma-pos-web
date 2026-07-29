# Project Detail Web Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the complete project detail in a route-aware modal from the web project list while preserving the standalone `/projects/[id]` page.

**Architecture:** Extract the current project detail into one shared server-rendered view, then render it from both the standalone page and a Next.js intercepted parallel route. A focused client dialog owns only modal interaction and browser Back behavior.

**Tech Stack:** Next.js 16.2.4 App Router, React 19.2.4, TypeScript, next-intl, Node test runner, ESLint.

## Global Constraints

- Preserve all existing project detail sections, service tabs, and actions.
- Preserve direct navigation and refresh behavior at `/projects/{id}`.
- Preserve the existing `/projects/{id}/documents/{documentId}/print` route.
- Do not change database schema, API contracts, or business rules.
- Follow the existing product-detail intercepted-route pattern.
- Keep web detail rendering in one shared implementation.

---

## File Structure

- `src/app/(app)/projects/[id]/project-detail-view.tsx`: shared project detail UI and header/action composition.
- `src/app/(app)/projects/[id]/page.tsx`: standalone route data loader and not-found boundary.
- `src/components/project-detail-dialog.tsx`: client-only modal shell, close behavior, and accessibility.
- `src/app/(app)/@projectModal/default.tsx`: empty parallel-slot fallback.
- `src/app/(app)/@projectModal/(.)projects/[id]/page.tsx`: intercepted project route data loader.
- `src/app/(app)/@projectModal/[...catchAll]/page.tsx`: clears stale modal slot after unrelated navigation.
- `src/app/(app)/layout.tsx`: renders the new `projectModal` slot.
- `tests/project-detail-view.test.tsx`: shared-view behavioral rendering test.
- `tests/project-detail-dialog.test.tsx`: dialog shell semantics and close-control test.

### Task 1: Extract a Shared Project Detail View

**Files:**
- Create: `src/app/(app)/projects/[id]/project-detail-view.tsx`
- Modify: `src/app/(app)/projects/[id]/page.tsx`
- Test: `tests/project-detail-view.test.tsx`

**Interfaces:**
- Consumes: `ProjectDetail` from `@/lib/data/projects`, `getServiceFormOptions()`, and `getTranslations()`.
- Produces: `ProjectDetailView({ detail, serviceOptions, presentation }: { detail: ProjectDetail; serviceOptions: Awaited<ReturnType<typeof getServiceFormOptions>> | null; presentation: "page" | "modal" }): React.ReactNode`.
- Produces: `ProjectDetailActions({ project, serviceOptions })` for one shared action implementation.

- [ ] **Step 1: Write the failing shared-view test**

Create a complete literal non-service project fixture and render
`ProjectDetailView` with `react-dom/server`. Assert that the page presentation
contains the project heading, the four existing metrics, and related-order
content. Render the modal presentation and assert it contains the same metrics
and related-order content without a standalone back link.

The production change this catches is accidentally maintaining two divergent
detail bodies or leaving standalone navigation chrome inside the modal.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx tsx --test tests/project-detail-view.test.tsx
```

Expected: FAIL because `project-detail-view.tsx` and `ProjectDetailView` do not
exist.

- [ ] **Step 3: Move the current detail body into the shared component**

Move the existing rendering and helper components from `page.tsx` without
changing business behavior. Add only the `presentation` branch:

```tsx
export function ProjectDetailView({
  detail,
  serviceOptions,
  presentation,
}: ProjectDetailViewProps) {
  const { project } = detail;
  return (
    <div className={presentation === "modal" ? "w-full" : "w-full p-4 sm:p-6"}>
      {presentation === "page" && (
        <ProjectDetailHeader project={project} serviceOptions={serviceOptions} />
      )}
      {presentation === "modal" && (
        <div className="flex justify-end px-4 pt-4 sm:px-6">
          <ProjectDetailActions project={project} serviceOptions={serviceOptions} />
        </div>
      )}
      <ProjectDetailBody detail={detail} serviceOptions={serviceOptions} />
    </div>
  );
}
```

Keep the full existing JSX inside private `ProjectDetailBody`. Extract the
header actions into `ProjectDetailActions` and reuse them in both presentations.

- [ ] **Step 4: Reduce the standalone page to data loading**

`page.tsx` loads `getProjectDetail(id)`, calls `notFound()` when absent, loads
service options only for service projects, and returns:

```tsx
<ProjectDetailView
  detail={detail}
  serviceOptions={serviceOptions}
  presentation="page"
/>
```

- [ ] **Step 5: Run the focused test and existing project tests**

Run:

```bash
npx tsx --test tests/project-detail-view.test.tsx tests/mobile-service-notifications.test.tsx
```

Expected: PASS with zero failures.

- [ ] **Step 6: Commit the extraction**

```bash
git add 'src/app/(app)/projects/[id]/page.tsx' \
  'src/app/(app)/projects/[id]/project-detail-view.tsx' \
  tests/project-detail-view.test.tsx
git commit -m "refactor: share project detail view"
```

### Task 2: Add the Accessible Project Detail Dialog

**Files:**
- Create: `src/components/project-detail-dialog.tsx`
- Test: `tests/project-detail-dialog.test.tsx`

**Interfaces:**
- Consumes: `title: string`, `subtitle: string`, and `children: ReactNode`.
- Produces: `ProjectDetailDialog`, which calls `router.back()` for close button, Escape, and backdrop click.

- [ ] **Step 1: Write the failing dialog behavior test**

Render the real dialog with the repository's existing client-component test
harness. Verify the rendered overlay has `role="dialog"`,
`aria-modal="true"`, the literal title and subtitle, an accessible close
button, and an independently scrollable content region.

The production changes this catches are removing dialog semantics, making the
close action unreachable, or allowing a long detail page to overflow the
viewport instead of scrolling inside the modal.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx tsx --test tests/project-detail-dialog.test.tsx
```

Expected: FAIL because `ProjectDetailDialog` does not exist.

- [ ] **Step 3: Implement the dialog shell**

Follow `ProductDetailDialog` styling, using `z-[80]`,
`h-dvh` on mobile, `sm:h-[min(92dvh,920px)]`, `max-w-7xl`, and
`overflow-y-auto` on the content viewport. Use:

```tsx
const close = useCallback(() => router.back(), [router]);
```

Register and remove the Escape listener in `useEffect`. Backdrop mouse-down
closes; mouse-down inside the dialog stops propagation. The close button label
uses the supplied localized `closeLabel`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx tsx --test tests/project-detail-dialog.test.tsx
```

Expected: PASS with zero failures.

- [ ] **Step 5: Commit the dialog**

```bash
git add src/components/project-detail-dialog.tsx tests/project-detail-dialog.test.tsx
git commit -m "feat: add project detail dialog"
```

### Task 3: Add the Intercepted Project Route

**Files:**
- Create: `src/app/(app)/@projectModal/default.tsx`
- Create: `src/app/(app)/@projectModal/(.)projects/[id]/page.tsx`
- Create: `src/app/(app)/@projectModal/[...catchAll]/page.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `ProjectDetailDialog`, `ProjectDetailView`, `getProjectDetail()`, `getServiceFormOptions()`, and `getTranslations()`.
- Produces: the `projectModal: React.ReactNode` authenticated-layout slot.

- [ ] **Step 1: Establish the failing integration check**

Run the production build before adding the slot route:

```bash
npm run build
```

Record the successful baseline. Then add only the intercepted page import that
references `projectModal` support and run the build again. Expected: FAIL until
the layout slot and default route exist. This is the Next.js route-contract
check; do not add a source-text test for framework-owned routing behavior.

- [ ] **Step 2: Add slot fallbacks**

Both fallback files return `null`:

```tsx
export default function DefaultProjectModal() {
  return null;
}
```

- [ ] **Step 3: Render the slot in the authenticated layout**

Add `projectModal` to the layout props and render it alongside the existing
`orderModal` and `productModal` slots:

```tsx
{orderModal}
{productModal}
{projectModal}
```

- [ ] **Step 4: Implement the intercepted route**

Load the same detail and service options as the standalone page. Render:

```tsx
<ProjectDetailDialog
  title={detail.project.name}
  subtitle={detail.project.customerName ?? t("projects.noCustomer")}
  closeLabel={t("common.close")}
>
  <ProjectDetailView
    detail={detail}
    serviceOptions={serviceOptions}
    presentation="modal"
  />
</ProjectDetailDialog>
```

Call `notFound()` for an unknown project.

- [ ] **Step 5: Run the production build and affected tests**

Run:

```bash
npx tsx --test tests/project-detail-view.test.tsx tests/project-detail-dialog.test.tsx tests/mobile-service-notifications.test.tsx
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the intercepted route**

```bash
git add 'src/app/(app)/layout.tsx' \
  'src/app/(app)/@projectModal' \
  'src/app/(app)/projects/[id]' \
  src/components/project-detail-dialog.tsx \
  tests/project-detail-view.test.tsx \
  tests/project-detail-dialog.test.tsx
git commit -m "feat: open project details in modal"
```

### Task 4: Web Regression Review

**Files:**
- Review: all files changed in Tasks 1–3.

**Interfaces:**
- Consumes: the completed web implementation.
- Produces: fresh verification evidence and a clean scoped diff.

- [ ] **Step 1: Inspect the complete diff**

Run:

```bash
git diff HEAD~3 --check
git diff HEAD~3 --stat
git status --short
```

Confirm no project data fields, service actions, document-print links, or
unrelated files were dropped.

- [ ] **Step 2: Run final web verification**

Run:

```bash
npx tsx --test tests/project-detail-view.test.tsx tests/project-detail-dialog.test.tsx tests/mobile-service-notifications.test.tsx tests/mobile-final-table-surfaces.test.tsx
npm run lint
npm run build
```

Expected: all commands exit 0 with zero test failures and zero lint errors.

- [ ] **Step 3: Record any unrelated pre-existing failures**

If a command fails, rerun the smallest affected command and classify the
failure before changing code. Do not alter unrelated behavior to make the
verification green.

