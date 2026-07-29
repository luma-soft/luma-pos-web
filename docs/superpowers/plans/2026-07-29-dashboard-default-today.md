# Dashboard Default Today Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Today the effective Dashboard range whenever the URL range is missing or invalid, while preserving every explicit supported range.

**Architecture:** Add a small pure range resolver beside the Dashboard data loader so range validation has one testable source of truth. The server-rendered Dashboard page will use that resolver, and the loader's omitted-argument default will also become `today`.

**Tech Stack:** TypeScript, Next.js 16 server components, Bun test runner, Drizzle data layer.

## Global Constraints

- `/dashboard` and unsupported `range` values must resolve to `today`.
- Explicit `today`, `7d`, `30d`, and `month` values must remain unchanged.
- Do not add a redirect or rewrite the browser URL.
- Do not change database schema, APIs, translations, or unrelated Dashboard behavior.

---

### Task 1: Centralize and test Dashboard range resolution

**Files:**
- Create: `tests/dashboard-default-range.test.ts`
- Create: `src/lib/dashboard/range.ts`
- Modify: `src/lib/data/dashboard.ts`
- Modify: `src/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Produces: `resolveDashboardRange(value: string | undefined): DashboardRange`
- Consumes: `DashboardRange = "today" | "7d" | "30d" | "month"`

- [x] **Step 1: Write the failing range tests**

```ts
import { describe, expect, test } from "bun:test";
import { resolveDashboardRange } from "@/lib/data/dashboard";

describe("resolveDashboardRange", () => {
  test("defaults a missing or unsupported range to today", () => {
    expect(resolveDashboardRange(undefined)).toBe("today");
    expect(resolveDashboardRange("quarter")).toBe("today");
  });

  test.each(["today", "7d", "30d", "month"] as const)(
    "preserves the supported %s range",
    (range) => {
      expect(resolveDashboardRange(range)).toBe(range);
    },
  );
});
```

- [x] **Step 2: Run the test and verify RED**

Run: `bun test tests/dashboard-default-range.test.ts`

Expected: FAIL because `resolveDashboardRange` is not exported.

- [x] **Step 3: Add the minimal resolver and loader default**

In `src/lib/dashboard/range.ts`, add:

```ts
const DASHBOARD_RANGES: readonly DashboardRange[] = ["today", "7d", "30d", "month"];

export function resolveDashboardRange(value: string | undefined): DashboardRange {
  return DASHBOARD_RANGES.includes(value as DashboardRange)
    ? value as DashboardRange
    : "today";
}
```

In `src/lib/data/dashboard.ts`, import the resolver and change:

```ts
export async function getDashboard(range: DashboardRange = "7d")
```

to:

```ts
export async function getDashboard(requestedRange?: DashboardRange) {
  const range = resolveDashboardRange(requestedRange);
```

- [x] **Step 4: Make the page use the resolver**

Import `resolveDashboardRange` into `src/app/(app)/dashboard/page.tsx`, remove
the page-local range membership check, and replace it with:

```ts
const range = resolveDashboardRange(params.range);
```

Keep the page-local `RANGES` array for rendering the four controls.

- [x] **Step 5: Run the focused test and verify GREEN**

Run: `bun test tests/dashboard-default-range.test.ts`

Expected: 5 tests and 6 assertions pass with exit code 0.

- [x] **Step 6: Run affected regression checks**

Run:

```bash
bun test tests/dashboard-default-range.test.ts tests/dashboard-financials.test.ts tests/mobile-dashboard-trend.test.ts
bunx tsc --noEmit
bunx eslint 'src/lib/data/dashboard.ts' 'src/app/(app)/dashboard/page.tsx' tests/dashboard-default-range.test.ts
```

Expected: all commands exit 0.

- [x] **Step 7: Review and commit the slice**

Run:

```bash
git diff --check
git diff -- src/lib/dashboard/range.ts src/lib/data/dashboard.ts 'src/app/(app)/dashboard/page.tsx' tests/dashboard-default-range.test.ts
git status --short
```

Commit only the plan, test, and Dashboard files:

```bash
git add docs/superpowers/plans/2026-07-29-dashboard-default-today.md tests/dashboard-default-range.test.ts src/lib/dashboard/range.ts src/lib/data/dashboard.ts 'src/app/(app)/dashboard/page.tsx'
git commit -m "fix(dashboard): default range to today"
```
