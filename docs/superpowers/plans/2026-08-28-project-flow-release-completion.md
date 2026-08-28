# Project Flow Release Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply migration 0109, remove release-blocking regressions, verify the approved project flow on web and iOS, then publish both repositories and upload the next iOS build to TestFlight.

**Architecture:** Keep the approved web/mobile project domain and visual hierarchy unchanged. Apply the existing additive database migration first, then fix only failures whose root cause is either the approved icon/touch contract or stale test infrastructure; validate through focused tests before running the full suites and release builds.

**Tech Stack:** Next.js 16, React 19, Bun, Drizzle/Postgres/Supabase, Flutter/Dart, Xcode/TestFlight.

**Spec:** `docs/projects-redesign-update-prompt.md`

## Global Constraints

- Preserve the existing global navigation and shared header components.
- Web and mobile must use the same project business logic and APIs.
- Selecting installed products must never create stock movements or change stock balances.
- Web pickers must remain custom Luma listboxes; mobile must reuse `SelectProductPage` with multi-selection.
- Installed-asset photos remain private, signed, retry-safe and limited to eight per asset.
- Use the approved Lucide/Luma icon contract without Material-icon fallbacks in the project flow.
- Mobile touch targets are at least 44 px while glyph sizes remain unchanged.
- Commit author and committer must be `cvthien <cvthien.dev@gmail.com>`.

---

### Task 1: Apply and verify migration 0109

**Files:**
- Verify: `drizzle/0109_installed_asset_batch_and_photos.sql`
- Use: `src/db/apply-migrations.ts`

**Interfaces:**
- Consumes: the current Supabase `DATABASE_URL` and the existing `_migrations` tracker.
- Produces: idempotency and photo-order columns/indexes used by the batch asset APIs.

- [ ] **Step 1: Run read-only duplicate/null preflight queries**

```sql
select store_id, serial_number, count(*)
from installed_assets
where serial_number is not null
group by store_id, serial_number
having count(*) > 1;
```

- [ ] **Step 2: Apply tracked migrations**

Run: `rtk bun run src/db/apply-migrations.ts`
Expected: `0109_installed_asset_batch_and_photos.sql` is applied exactly once and recorded in `_migrations`.

- [ ] **Step 3: Verify the live schema**

```sql
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'installed_assets' and column_name = 'client_request_id')
    or (table_name = 'service_attachments' and column_name in ('client_request_id', 'sort_order', 'is_primary')));
```

Expected: four rows are returned and `_migrations` contains `0109_installed_asset_batch_and_photos.sql`.

### Task 2: Restore web release gates

**Files:**
- Modify: `src/app/(app)/services/installed-asset-batch-create.tsx`
- Modify only if required by root-cause evidence: `src/components/list-search-filter.tsx`
- Modify behavior-based assertions only: `tests/mobile-active-control-audit.test.ts`, `tests/suppliers-toolbar.test.tsx`, `tests/mobile-responsive-audit.test.ts`

**Interfaces:**
- Consumes: the approved 44 px mobile/tablet interaction contract.
- Produces: explicit touch geometry without changing desktop glyph size or visual hierarchy.

- [ ] **Step 1: Reproduce each of the three failing web tests independently**

Run: `rtk bun test tests/mobile-active-control-audit.test.ts tests/suppliers-toolbar.test.tsx tests/mobile-responsive-audit.test.ts`
Expected: the current touch-contract and stale exact-source assertions fail.

- [ ] **Step 2: Replace source-string assertions with rendered/semantic behavior assertions where possible**

The regression must fail when a mobile control becomes smaller than 44 px, not merely when `h-11` changes to an equivalent `min-h-11` class.

- [ ] **Step 3: Give every installed-asset interactive control an explicit 44 px mobile/tablet target**

Keep inner Lucide glyph sizes from `docs/installed-asset-icon-contract.md`; enlarge only the clickable wrapper.

- [ ] **Step 4: Run focused web tests**

Run: `rtk bun test tests/mobile-active-control-audit.test.ts tests/suppliers-toolbar.test.tsx tests/mobile-responsive-audit.test.ts tests/service-installed-assets-batch.test.ts`
Expected: all selected tests pass.

### Task 3: Restore mobile icon and golden contracts

**Files:**
- Modify: `test/core/widgets/mobile_primitives_test.dart`
- Inspect/update only after visual review: affected golden PNGs reported by `rtk flutter test`
- Modify production only for a confirmed runtime defect: `lib/src/core/widgets/mobile_primitives.dart`, `lib/src/core/widgets/select_product_page.dart`

**Interfaces:**
- Consumes: `LumaDesignIcon('filter')`, shared `MobileTopBar`, and the approved mobile project flow.
- Produces: tests that assert the actual Luma icon contract and reviewed golden baselines.

- [ ] **Step 1: Reproduce the focused stale icon assertion**

Run: `rtk flutter test test/core/widgets/mobile_primitives_test.dart`
Expected: the old `Icons.tune` assertion fails while runtime renders `LumaDesignIcon('filter')`.

- [ ] **Step 2: Update the test to assert the semantic Luma icon**

Assert a `LumaDesignIcon` with `name == 'filter'`; do not restore `Icons.tune`.

- [ ] **Step 3: Isolate golden failures from cascading widget fixture failures**

Run each failing test file independently. Update a golden only after comparing failure/current/reference images and confirming that the difference is an approved icon/font/layout change.

- [ ] **Step 4: Fix genuine fixture/runtime failures at their root cause**

Each fix must have an isolated failing test before production changes and must not alter the approved project navigation/header.

- [ ] **Step 5: Run focused project/mobile suites**

Run: `rtk flutter test test/core/widgets/select_product_page_test.dart test/features/more/project_detail_screen_test.dart test/core/widgets/mobile_primitives_test.dart`
Expected: all selected tests pass.

### Task 4: Full verification and runtime comparison

**Files:**
- Verify all modified web/mobile files and approved source renders.

**Interfaces:**
- Consumes: integrated code and migrated live schema.
- Produces: fresh release evidence for tests, static checks, builds and UI parity.

- [ ] **Step 1: Run web verification**

Run: `rtk bun test && rtk bun x drizzle-kit check && rtk bun run build && rtk git diff --check`
Expected: exit code 0 for every command.

- [ ] **Step 2: Run mobile verification**

Run: `rtk flutter test && rtk flutter analyze && rtk git diff --check`
Expected: exit code 0 for every command.

- [ ] **Step 3: Verify live behavior**

Create a test batch through the authenticated project flow, upload/reorder/retry photos, reload signed thumbnails, and compare stock balance/movement counts before and after.
Expected: assets and attachments persist without any stock mutation or duplicate retry records.

- [ ] **Step 4: Compare web and iPhone 17 simulator screenshots**

Use the same viewport and selected-product state as the approved source render. Confirm no P0/P1/P2 mismatch in icon, hierarchy, spacing, radius, typography or header geometry.

### Task 5: Publish and upload TestFlight build

**Files:**
- Modify through the release script: `luma-pos-mobile/pubspec.yaml`
- Commit all approved changes in both repositories.

**Interfaces:**
- Consumes: green full suites, successful production builds and configured Apple signing.
- Produces: pushed `main` commits and a processed TestFlight build containing the latest header/icon/device flow.

- [ ] **Step 1: Verify remote access and author identity**

Run: `rtk git ls-remote origin HEAD && rtk git config user.name && rtk git config user.email`
Expected: remote access succeeds and identity is `cvthien <cvthien.dev@gmail.com>`.

- [ ] **Step 2: Commit and push web, then mobile**

Commit messages must describe the project installed-asset flow and release-test fixes. Push the currently checked-out `main` branches directly.

- [ ] **Step 3: Build and upload iOS through the repository release script**

Use the current `1.0.0` marketing version and advance only the numeric build code after a successful upload, following `test/tool/build_ios_release_test.dart`.

- [ ] **Step 4: Verify delivery**

Confirm both remotes point to the new commits and the uploaded build reaches Apple processing/TestFlight without changing the marketing version.
