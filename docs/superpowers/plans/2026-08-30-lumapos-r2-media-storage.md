# LumaPOS R2 Media Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every LumaPOS-managed media upload to Cloudflare R2 while keeping Supabase Database/Auth, preserving existing web/mobile behavior, and providing a reversible migration for existing Supabase objects.

**Architecture:** Add a canonical `media_objects` registry and a provider-neutral storage boundary with R2 as the write provider and Supabase as a temporary fallback. Public catalog assets resolve through `media.lumapos.shop`; private project/service/AI assets resolve through authorized short-lived signed URLs. Existing response fields remain compatible while web and Flutter adopt media descriptors incrementally.

**Tech Stack:** Next.js 16, TypeScript, Bun, Drizzle/Postgres on Supabase, Supabase Auth, Cloudflare R2 S3 API, AWS SDK v3, React 19, Flutter/Dart, Vitest-compatible Bun tests, Flutter widget/unit tests.

**Spec:** `docs/superpowers/specs/2026-08-30-lumapos-r2-media-storage-design.md`

## Global Constraints

- Supabase Database, Auth, and Realtime remain unchanged; only LumaPOS-owned binary objects move.
- Do not copy camera URLs, vendor app URLs, payment/checkout URLs, Shopee-hosted media, or arbitrary user-entered external URLs.
- Use `lumapos-<environment>-public-media` and `lumapos-<environment>-private-media` as separate R2 buckets.
- Production public media uses immutable URLs under `https://media.lumapos.shop`.
- Private objects never receive public URLs; every download requires backend authorization and a short-lived signed URL.
- Keep `imageUrl`, `imageUrls`, `photoUrls`, and `signedUrl` compatibility fields until active web and mobile clients use media descriptors.
- Use immutable object keys under `stores/<store-id>/<domain>/<yyyy>/<mm>/<media-id>/original.<validated-extension>`; the original filename remains database metadata and never enters the object key.
- All new exposed-schema tables have RLS enabled; authenticated policies include store ownership and never rely only on `TO authenticated`.
- R2/Supabase privileged credentials remain server-side and must never use a `NEXT_PUBLIC_` prefix.
- Migrations are idempotent and reversible; retain Supabase fallback for at least 30 days before source deletion.
- Use existing Luma custom controls and `LumaDesignIcon` assets; do not introduce native visible web selects or replacement mobile navigation/header components.
- Preserve app-wide `LumaKeyboardDismissScope` and open mobile sheets through `showLumaModalSheet`.
- Pin new dependencies and commit `bun.lock`.
- Run shell commands through `rtk`.
- Run web/backend commands with working directory `/Users/cvthien/project/LumaPOS/luma-pos-web` and Flutter commands with working directory `/Users/cvthien/project/LumaPOS/luma-pos-mobile`; do not assume the workspace root is a Git repository.

## File Structure

### Web/backend repository: `luma-pos-web`

- `src/lib/media/types.ts`: provider-neutral media and storage contracts.
- `src/lib/media/config.ts`: validated R2 environment configuration and feature flags.
- `src/lib/media/object-key.ts`: tenant-safe immutable object-key generation.
- `src/lib/media/r2-storage.ts`: AWS SDK/R2 implementation.
- `src/lib/media/supabase-storage.ts`: temporary legacy read/delete adapter.
- `src/lib/media/storage.ts`: adapter selection and dependency injection.
- `src/lib/media/repository.ts`: `media_objects` persistence and state transitions.
- `src/lib/media/service.ts`: upload, resolution, completion, soft-delete, and authorization-neutral orchestration.
- `src/lib/media/image-variants.ts`: bounded thumbnail generation for managed images.
- `src/lib/media/project-media.ts`: project attachment association/query/delete operations.
- `src/lib/media/migration.ts`: inventory, copy, verification, cutover, and rollback core.
- `src/lib/media/cleanup.ts`: pending/orphan/deleted object cleanup worker.
- `src/app/api/mobile/media/uploads/route.ts`: upload-intent creation.
- `src/app/api/mobile/media/uploads/[mediaId]/complete/route.ts`: upload completion.
- `src/app/api/mobile/media/[mediaId]/route.ts`: authorized resolve/delete endpoint.
- `src/app/api/mobile/services/projects/[id]/attachments/route.ts`: project-wide dossier attachments.
- `src/app/api/cron/media/cleanup/route.ts`: protected scheduled cleanup.
- `src/app/(app)/projects/[id]/project-media-panel.tsx`: shared web project media UI.
- `src/app/(app)/projects/[id]/project-redesigned-experience.tsx`: mounts media panel in Aftercare and Finance/Files.
- `src/app/(app)/services/installed-asset-batch-create.tsx`: post-install project-photo CTA.
- `src/db/schema.ts`: media registry, explicit relationships, compatibility columns.
- `drizzle/0110_unified_media_storage.sql`: schema, indexes, constraints, and RLS.
- `src/scripts/migrate-media-to-r2.ts`: operational CLI.
- `.env.example`, `package.json`, `bun.lock`, `vercel.json`: R2 configuration, pinned SDK, scripts, cron.

### Mobile repository: `luma-pos-mobile`

- `lib/src/core/api/api_client.dart`: absolute signed PUT support.
- `lib/src/core/api/mobile_endpoints.dart`: media and project-attachment endpoints.
- `lib/src/core/api/mobile_data_repository.dart`: media upload/resolve/project attachment methods.
- `lib/src/core/media/media_upload.dart`: reusable intent → PUT → complete workflow.
- `lib/src/features/more/domain/project_detail.dart`: project attachment media model.
- `lib/src/features/more/presentation/project_media_section.dart`: dossier list and upload flow.
- `lib/src/features/more/presentation/project_detail_screen.dart`: integrates project media and post-install CTA.
- `lib/src/features/more/data/product_image_upload.dart`: returns `mediaId` with compatibility URL/path.

---

### Task 1: R2 configuration and provider-neutral storage boundary

**Files:**
- Modify: `luma-pos-web/package.json`
- Modify: `luma-pos-web/bun.lock`
- Modify: `luma-pos-web/.env.example`
- Create: `luma-pos-web/src/lib/media/types.ts`
- Create: `luma-pos-web/src/lib/media/config.ts`
- Create: `luma-pos-web/src/lib/media/object-key.ts`
- Create: `luma-pos-web/src/lib/media/r2-storage.ts`
- Create: `luma-pos-web/src/lib/media/supabase-storage.ts`
- Create: `luma-pos-web/src/lib/media/storage.ts`
- Test: `luma-pos-web/tests/media-storage.test.ts`

**Interfaces:**
- Produces: `ObjectStorage`, `MediaProvider`, `MediaVisibility`, `MediaObjectHead`, `createObjectKey()`, `getObjectStorage(provider)`, and `getR2Config()`.
- Consumes: existing `createSupabaseAdminClient()` only inside `supabase-storage.ts`.

- [ ] **Step 1: Write the failing storage-contract and key-safety tests**

```ts
import { describe, expect, test } from "bun:test";
import { createObjectKey } from "../src/lib/media/object-key";
import { readR2Config } from "../src/lib/media/config";

test("creates an immutable tenant key without exposing the original filename", () => {
  const key = createObjectKey({
    storeId: "11111111-1111-4111-8111-111111111111",
    domain: "projects",
    mediaId: "22222222-2222-4222-8222-222222222222",
    fileName: "Biên bản Chị Hậu / 0909 123 456.pdf",
    now: new Date("2026-08-30T00:00:00Z"),
  });
  expect(key).toBe("stores/11111111-1111-4111-8111-111111111111/projects/2026/08/22222222-2222-4222-8222-222222222222/original.pdf");
  expect(key).not.toContain("Chi-Hau");
  expect(key).not.toContain("0909");
});

test("rejects incomplete R2 credentials", () => {
  expect(() => readR2Config({ R2_ACCOUNT_ID: "account" })).toThrow("R2 configuration is incomplete");
});
```

- [ ] **Step 2: Run the new test and verify the modules are missing**

Run: `rtk bun test tests/media-storage.test.ts`  
Expected: FAIL because `src/lib/media/object-key.ts` and `src/lib/media/config.ts` do not exist.

- [ ] **Step 3: Install pinned AWS SDK packages and implement the contracts**

Run:

```bash
rtk bun add --exact @aws-sdk/client-s3@3.1121.0 @aws-sdk/s3-request-presigner@3.1121.0
```

Define the central interface exactly once:

```ts
export type MediaProvider = "r2" | "supabase";
export type MediaVisibility = "public" | "private";

export type MediaObjectHead = {
  sizeBytes: number;
  contentType: string | null;
  etag: string | null;
};

export interface ObjectStorage {
  put(input: { bucket: string; key: string; body: Uint8Array; contentType: string }): Promise<MediaObjectHead>;
  get(input: { bucket: string; key: string }): Promise<Uint8Array>;
  head(input: { bucket: string; key: string }): Promise<MediaObjectHead | null>;
  createUploadUrl(input: { bucket: string; key: string; contentType: string; expiresInSeconds: number }): Promise<string>;
  createDownloadUrl(input: { bucket: string; key: string; expiresInSeconds: number }): Promise<string>;
  remove(input: { bucket: string; key: string }): Promise<void>;
  publicUrl(input: { key: string }): string;
}
```

`r2-storage.ts` must use `S3Client({ region: "auto", endpoint: "https://<account>.r2.cloudflarestorage.com" })`, `PutObjectCommand`, `HeadObjectCommand`, `GetObjectCommand`, `DeleteObjectCommand`, and `getSignedUrl`. `get()` converts the `GetObjectCommand` body with `transformToByteArray()`. Sign `ContentType` on PUT URLs. `supabase-storage.ts` supports legacy `put`, `get`, signed download, `head`, and removal but never becomes the default write provider.

Add these server-only variables to `.env.example`:

```dotenv
MEDIA_WRITE_PROVIDER=r2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_PUBLIC_BUCKET=lumapos-production-public-media
R2_PRIVATE_BUCKET=lumapos-production-private-media
R2_PUBLIC_BASE_URL=https://media.lumapos.shop
MEDIA_SUPABASE_FALLBACK_ENABLED=true
```

- [ ] **Step 4: Run focused tests and TypeScript checking**

Run:

```bash
rtk bun test tests/media-storage.test.ts
rtk bunx tsc --noEmit
```

Expected: PASS; no credential values appear in client bundles or `NEXT_PUBLIC_` variables.

- [ ] **Step 5: Commit the storage boundary**

```bash
rtk git add package.json bun.lock .env.example src/lib/media tests/media-storage.test.ts
rtk git commit -m "feat(media): add R2 storage boundary"
```

### Task 2: Canonical media schema, explicit references, and tenant security

**Files:**
- Modify: `luma-pos-web/src/db/schema.ts`
- Create: `luma-pos-web/drizzle/0110_unified_media_storage.sql`
- Create: `luma-pos-web/src/lib/media/repository.ts`
- Test: `luma-pos-web/tests/media-schema.test.mjs`
- Modify: `luma-pos-web/tests/tenant-ownership-manifest.test.ts`
- Modify: `luma-pos-web/src/scripts/audit-extended-tenancy.ts`

**Interfaces:**
- Consumes: `MediaProvider`, `MediaVisibility` from Task 1.
- Produces: Drizzle tables `mediaObjects`, `productMedia`, `serviceHandoverDocumentMedia`, `mediaMigrationRuns`, `mediaMigrationItems`; repository methods `createPendingMedia()`, `markMediaReady()`, `getMediaForStore()`, `softDeleteMedia()`.

- [ ] **Step 1: Write schema and RLS assertions before adding tables**

```js
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const sql = readFileSync("drizzle/0110_unified_media_storage.sql", "utf8");

test("media tables are tenant-owned and protected by RLS", () => {
  expect(sql).toContain('CREATE TABLE "media_objects"');
  expect(sql).toContain('"store_id" uuid NOT NULL');
  expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
  expect(sql).toContain("store_id = public.current_active_store_id()");
  expect(sql).not.toMatch(/FOR (?:UPDATE|INSERT|DELETE) TO authenticated/);
});

test("service attachments retain compatibility coordinates", () => {
  expect(sql).toContain('ADD COLUMN "media_object_id" uuid');
  expect(sql).not.toContain('DROP COLUMN "bucket"');
  expect(sql).not.toContain('DROP COLUMN "path"');
});
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run: `rtk bun test tests/media-schema.test.mjs`  
Expected: FAIL because migration `0110_unified_media_storage.sql` does not exist.

- [ ] **Step 3: Add tables, constraints, indexes, and compatibility columns**

Create the migration with statement breakpoints and mirror it in `schema.ts`. The canonical table must include:

```sql
CREATE TABLE "media_objects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "provider" text DEFAULT 'r2' NOT NULL,
  "visibility" text NOT NULL,
  "domain" text NOT NULL,
  "bucket" text NOT NULL,
  "object_key" text NOT NULL,
  "original_file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" varchar(64),
  "width" integer,
  "height" integer,
  "thumbnail_object_key" text,
  "thumbnail_size_bytes" bigint,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_by" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "ready_at" timestamptz,
  "verified_at" timestamptz,
  "deleted_at" timestamptz,
  "legacy_bucket" text,
  "legacy_path" text,
  "legacy_url" text,
  CONSTRAINT "media_objects_provider_check" CHECK ("provider" IN ('r2','supabase')),
  CONSTRAINT "media_objects_visibility_check" CHECK ("visibility" IN ('public','private')),
  CONSTRAINT "media_objects_status_check" CHECK ("status" IN ('pending','ready','quarantined','deleted')),
  CONSTRAINT "media_objects_size_check" CHECK ("size_bytes" > 0),
  CONSTRAINT "media_objects_location_unique" UNIQUE ("provider","bucket","object_key")
);
```

Add explicit relation tables and fields:

- `product_media(product_id, media_object_id, sort_order, is_primary)` with one active primary image per product.
- `brands.logo_media_object_id` nullable.
- `service_attachments.media_object_id` nullable and `project_phase` nullable with allowed values `survey`, `construction`, `after_installation`, `acceptance`, `handover`, `other`.
- `service_customer_request_attachments.media_object_id` nullable.
- `service_handover_document_media(document_id, media_object_id, sort_order)`.
- `media_migration_runs` and `media_migration_items` with unique `(run_id, source_provider, source_bucket, source_key)` for resumability.

Enable RLS on every new table. Permit authenticated `SELECT` only when `store_id = public.current_active_store_id()`; all writes go through the backend database connection. Add all tenant tables to the existing extended-tenancy audit manifest.

- [ ] **Step 4: Implement repository state transitions with store scoping**

```ts
export async function markMediaReady(input: {
  storeId: string;
  mediaId: string;
  actualSizeBytes: number;
  readyAt?: Date;
}) {
  const [row] = await db.update(mediaObjects).set({
    status: "ready",
    sizeBytes: input.actualSizeBytes,
    readyAt: input.readyAt ?? new Date(),
  }).where(and(
    eq(mediaObjects.id, input.mediaId),
    eq(mediaObjects.storeId, input.storeId),
    eq(mediaObjects.status, "pending"),
  )).returning();
  return row ?? null;
}
```

Every update/delete query includes both `id` and `storeId`. State changes are one-way except the explicit migration rollback operation.

- [ ] **Step 5: Run schema, tenancy, and type checks**

Run:

```bash
rtk bun test tests/media-schema.test.mjs tests/tenant-ownership-manifest.test.ts
rtk bun run audit:extended-tenancy
rtk bunx tsc --noEmit
```

Expected: PASS and no new tenant-owned table is missing from the audit.

- [ ] **Step 6: Commit schema and repository**

```bash
rtk git add src/db/schema.ts drizzle/0110_unified_media_storage.sql src/lib/media/repository.ts tests src/scripts/audit-extended-tenancy.ts
rtk git commit -m "feat(media): add tenant media registry"
```

### Task 3: Upload-intent, completion, resolution, and deletion APIs

**Files:**
- Create: `luma-pos-web/src/lib/media/schemas.ts`
- Create: `luma-pos-web/src/lib/media/service.ts`
- Create: `luma-pos-web/src/lib/media/image-variants.ts`
- Create: `luma-pos-web/src/lib/media/authorization.ts`
- Create: `luma-pos-web/src/app/api/mobile/media/uploads/route.ts`
- Create: `luma-pos-web/src/app/api/mobile/media/uploads/[mediaId]/complete/route.ts`
- Create: `luma-pos-web/src/app/api/mobile/media/[mediaId]/route.ts`
- Test: `luma-pos-web/tests/media-api.test.ts`
- Test: `luma-pos-web/tests/media-image-variants.test.ts`

**Interfaces:**
- Consumes: `ObjectStorage`, media repository, existing mobile auth gates.
- Produces: `POST /api/mobile/media/uploads`, `POST /api/mobile/media/uploads/:mediaId/complete`, `GET|DELETE /api/mobile/media/:mediaId`, `MediaDescriptor`.

- [ ] **Step 1: Write failing API contract tests**

```ts
test("private upload intent binds tenant, purpose, type, and size", async () => {
  const response = await createIntent(jsonRequest({
    purpose: "project-document",
    targetId: PROJECT_ID,
    fileName: "nghiem-thu.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
  }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data).toMatchObject({
    media: { visibility: "private", status: "pending" },
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
  });
  expect(body.data.uploadUrl).toContain("X-Amz-Signature=");
});

test("cross-store media resolution is not found", async () => {
  const response = await resolveMedia(new Request(`https://app/api/mobile/media/${OTHER_STORE_MEDIA_ID}`));
  expect(response.status).toBe(404);
});
```

- [ ] **Step 2: Run the API tests and verify missing routes fail**

Run: `rtk bun test tests/media-api.test.ts`  
Expected: FAIL because media routes and service do not exist.

- [ ] **Step 3: Implement validated purpose policies and upload intent**

Use one controlled policy map:

```ts
export const MEDIA_PURPOSES = {
  "product-image": { domain: "products", visibility: "public", maxBytes: 10 * 1024 * 1024, mime: /^image\// },
  "project-document": { domain: "projects", visibility: "private", maxBytes: 25 * 1024 * 1024, mime: /^(image\/|application\/pdf$|application\/vnd\.)/ },
  "service-evidence": { domain: "service-evidence", visibility: "private", maxBytes: 15 * 1024 * 1024, mime: /^(image\/|application\/pdf$)/ },
  "ai-attachment": { domain: "ai", visibility: "private", maxBytes: 15 * 1024 * 1024, mime: /^(image\/|application\/pdf$|text\/)/ },
} as const;
```

Authorization resolves the corresponding existing stock/service/AI permission before creating a pending row. Upload URLs expire after 10 minutes and sign `Content-Type`.

- [ ] **Step 4: Implement completion, private resolve, and soft delete**

Completion performs `HEAD`, requires exact expected size and content type, marks the media ready, and returns:

```ts
export type MediaDescriptor = {
  id: string;
  visibility: "public" | "private";
  mimeType: string;
  sizeBytes: number;
  fileName: string;
  url: string;
  thumbnailUrl: string | null;
};
```

For public objects `url` is the immutable first-party URL. For private objects it is a 15-minute signed URL produced only after target authorization. DELETE soft-deletes metadata and schedules physical cleanup; it never removes a referenced signature/evidence object synchronously.

For image MIME types, completion downloads the ready original through `ObjectStorage.get()`, uses the existing pinned `sharp` dependency to apply EXIF rotation, bounds the image to 640×640 without enlargement, converts it to WebP quality 78, and stores `<media-prefix>/thumbnail.webp`. Save `thumbnail_object_key` and `thumbnail_size_bytes`. Thumbnail failure is logged and returns `thumbnailUrl: null`; it never changes a valid original from `ready` to failed.

- [ ] **Step 5: Run focused tests and type checking**

Run:

```bash
rtk bun test tests/media-api.test.ts tests/media-image-variants.test.ts
rtk bunx tsc --noEmit
```

Expected: PASS including expired intent, wrong size, wrong MIME, cross-store access, and idempotent completion cases.

- [ ] **Step 6: Commit media APIs**

```bash
rtk git add src/lib/media src/app/api/mobile/media tests/media-api.test.ts
rtk git commit -m "feat(media): add secure upload and resolve APIs"
```

### Task 4: Shared signed-upload clients for web and Flutter

**Files:**
- Create: `luma-pos-web/src/lib/media/client.ts`
- Test: `luma-pos-web/tests/media-upload-client.test.ts`
- Modify: `luma-pos-mobile/lib/src/core/api/api_client.dart`
- Modify: `luma-pos-mobile/lib/src/core/api/mobile_endpoints.dart`
- Create: `luma-pos-mobile/lib/src/core/media/media_upload.dart`
- Test: `luma-pos-mobile/test/core/api/api_client_test.dart`
- Create: `luma-pos-mobile/test/core/media/media_upload_test.dart`

**Interfaces:**
- Consumes: Task 3 APIs.
- Produces: web `uploadManagedMedia(file, request)` and Flutter `MediaUploadClient.upload(ManagedMediaDraft)` returning the same media descriptor.

- [ ] **Step 1: Write failing web and Flutter upload-state tests**

```ts
test("web client performs intent, signed PUT, then completion", async () => {
  const calls: string[] = [];
  const result = await uploadManagedMedia(FILE, REQUEST, async (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return fakeResponseFor(url);
  });
  expect(calls).toEqual([
    "POST /api/mobile/media/uploads",
    "PUT https://r2.test/signed",
    `POST /api/mobile/media/uploads/${MEDIA_ID}/complete`,
  ]);
  expect(result.id).toBe(MEDIA_ID);
});
```

```dart
test('keeps the media id pending when signed PUT fails', () async {
  final result = await uploader.upload(draft);
  expect(result.ok, isFalse);
  expect(fake.completeCalls, isEmpty);
  expect(fake.intentCalls, hasLength(1));
});
```

- [ ] **Step 2: Run tests and verify missing helpers fail**

Run:

```bash
rtk bun test tests/media-upload-client.test.ts
rtk flutter test test/core/media/media_upload_test.dart test/core/api/api_client_test.dart
```

Expected: FAIL because the shared upload clients and absolute PUT method do not exist.

- [ ] **Step 3: Implement web upload sequencing and retry-safe errors**

The web helper sends `Content-Type` exactly as returned by the intent, never forwards Luma authorization to R2, and calls completion only after a 2xx PUT. Abort signals cancel all three stages.

- [ ] **Step 4: Implement Flutter absolute byte PUT**

Add this public method without passing bearer or cashier headers to the signed host:

```dart
Future<ApiResponse<void>> putAbsoluteBytes(
  Uri uri, {
  required List<int> bytes,
  required Map<String, String> headers,
}) async {
  final request = await _httpClient.openUrl('PUT', uri);
  headers.forEach(request.headers.set);
  request.add(bytes);
  final response = await request.close();
  await response.drain<void>();
  return response.statusCode >= 200 && response.statusCode < 300
      ? ApiResponse.success(null, statusCode: response.statusCode)
      : ApiResponse.failure('media.uploadFailed', statusCode: response.statusCode);
}
```

`MediaUploadClient` performs the same intent → PUT → complete sequence and returns `MediaUploadResult(mediaId, url, mimeType, sizeBytes, fileName)`.

- [ ] **Step 5: Run both client test sets**

Run:

```bash
rtk bun test tests/media-upload-client.test.ts
rtk flutter test test/core/media/media_upload_test.dart test/core/api/api_client_test.dart
```

Expected: PASS, including cancellation, PUT failure, completion failure, and no-auth-header-to-R2 assertions.

- [ ] **Step 6: Commit web and Flutter upload clients in their respective repositories**

```bash
rtk git add src/lib/media/client.ts tests/media-upload-client.test.ts
rtk git commit -m "feat(media): add web signed upload client"
```

```bash
rtk git add lib/src/core/api lib/src/core/media test/core
rtk git commit -m "feat(media): add mobile signed upload client"
```

### Task 5: Public product media on R2

**Files:**
- Modify: `luma-pos-web/src/lib/images/product-image-upload.ts`
- Modify: `luma-pos-web/src/lib/images/product-image-route.ts`
- Modify: `luma-pos-web/src/lib/actions/products.ts`
- Modify: `luma-pos-web/src/app/(app)/products/new/product-form.tsx`
- Modify: `luma-pos-web/src/app/(app)/products/new/schema.ts`
- Modify: `luma-pos-web/tests/product-image-upload-client.test.ts`
- Modify: `luma-pos-web/tests/mobile-product-image-upload-route.test.ts`
- Modify: `luma-pos-mobile/lib/src/features/more/data/product_image_upload.dart`
- Modify: `luma-pos-mobile/lib/src/core/api/mobile_data_repository.dart`
- Modify: `luma-pos-mobile/lib/src/features/more/presentation/products_screen.dart`
- Modify: `luma-pos-mobile/test/features/more/data/product_image_upload_test.dart`

**Interfaces:**
- Consumes: Task 4 upload clients and `productMedia` table.
- Produces: uploaded product image `{ mediaId, url, path }`; product mutations accept `imageMediaIds` while preserving `imageUrls`.

- [ ] **Step 1: Extend existing tests to require `mediaId` and immutable public URL**

```ts
expect(uploaded).toEqual({
  mediaId: "media-1",
  path: "stores/store-1/products/2026/08/media-1/original.webp",
  url: "https://media.lumapos.shop/stores/store-1/products/2026/08/media-1/original.webp",
});
```

```dart
expect(result.uploaded.single.mediaId, 'media-1');
expect(result.urls.single, startsWith('https://media.lumapos.shop/'));
```

- [ ] **Step 2: Run product upload tests and verify compatibility code fails the new contract**

Run:

```bash
rtk bun test tests/product-image-upload-client.test.ts tests/mobile-product-image-upload-route.test.ts
rtk flutter test test/features/more/data/product_image_upload_test.dart
```

Expected: FAIL because current responses contain only `url/path`.

- [ ] **Step 3: Switch web product uploads to managed public media**

Use purpose `product-image`, store returned media IDs in form state, and submit both:

```ts
{
  imageMediaIds: uploadedImages.map((image) => image.mediaId),
  imageUrls: [...externalImageUrls, ...uploadedImages.map((image) => image.url)],
}
```

Inside the product create/update transaction, validate every media ID belongs to the same store, is `ready/public/products`, replace `product_media` ordering, and retain external URLs only in `products.image_urls`. Derive compatibility URLs from the associated ready media objects plus external URLs.

Keep `/api/mobile/products/images` operational for old clients, but make its multipart handler write through `MediaService` to R2 and return `{ mediaId, url, path }`.

- [ ] **Step 4: Switch Flutter product image state to preserve media IDs**

Extend `UploadedProductImage`:

```dart
class UploadedProductImage {
  const UploadedProductImage({
    required this.mediaId,
    required this.url,
    required this.path,
  });
  final String mediaId;
  final String url;
  final String path;
}
```

Product create/update bodies send ordered `imageMediaIds` and compatibility `imageUrls`. Retry retains completed media IDs and uploads only remaining drafts.

- [ ] **Step 5: Run product, catalog, and type/widget tests**

Run:

```bash
rtk bun test tests/product-image-upload-client.test.ts tests/mobile-product-image-upload-route.test.ts
rtk bunx tsc --noEmit
rtk flutter test test/features/more/data/product_image_upload_test.dart test/core/catalog/catalog_repository_test.dart test/features/more/presentation/product_image_editor_page_test.dart
```

Expected: PASS and catalog payloads still expose ordered `imageUrls`.

- [ ] **Step 6: Commit public-media integration in each repository**

```bash
rtk git add src/lib/images src/lib/actions/products.ts 'src/app/(app)/products' tests
rtk git commit -m "feat(products): store managed images in R2"
```

```bash
rtk git add lib/src/features/more lib/src/core/api test/features/more
rtk git commit -m "feat(products): persist managed media ids"
```

### Task 6: Private service media backend and project-wide dossier API

**Files:**
- Create: `luma-pos-web/src/lib/media/project-media.ts`
- Modify: `luma-pos-web/src/app/api/mobile/services/jobs/[id]/attachments/route.ts`
- Modify: `luma-pos-web/src/app/api/mobile/services/jobs/[id]/attachments/[attachmentId]/route.ts`
- Modify: `luma-pos-web/src/app/api/mobile/services/assets/[assetId]/attachments/route.ts`
- Modify: `luma-pos-web/src/app/api/mobile/services/warranty-claims/route.ts`
- Modify: `luma-pos-web/src/app/api/portal/service-request/[token]/route.ts`
- Modify: `luma-pos-web/src/app/api/mobile/services/customer-requests/[id]/attachments/[attachmentId]/route.ts`
- Create: `luma-pos-web/src/app/api/mobile/services/projects/[id]/attachments/route.ts`
- Modify: `luma-pos-web/src/lib/data/projects.ts`
- Test: `luma-pos-web/tests/project-media.test.ts`
- Modify: `luma-pos-web/tests/service-evidence.test.ts`
- Modify: `luma-pos-web/tests/service-installed-assets-batch.test.ts`
- Modify: `luma-pos-web/tests/service-technician-warranty-multipart.test.ts`
- Modify: `luma-pos-web/tests/service-customer-request-multipart.test.ts`

**Interfaces:**
- Consumes: `MediaService`, media repository, existing service authorization/locking.
- Produces: project endpoint returning `{ id, mediaId, phase, caption, fileName, mimeType, sizeBytes, createdAt, signedUrl }`; legacy service endpoint shapes remain valid.

- [ ] **Step 1: Write failing project attachment and R2 persistence tests**

```ts
test("project dossier accepts a private file without a job or asset", async () => {
  const response = await postProjectAttachment(PROJECT_ID, formFile("site-after.jpg", "image/jpeg", JPEG));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data).toMatchObject({
    phase: "after_installation",
    fileName: "site-after.jpg",
    mimeType: "image/jpeg",
  });
  expect(fakeStorage.puts[0].bucket).toBe("lumapos-test-private-media");
  expect(fakeStorage.puts[0].key).toContain(`/projects/`);
});

test("legacy installed asset endpoint returns an R2 signedUrl", async () => {
  const response = await getAssetPhotos(ASSET_ID);
  expect((await response.json()).data[0].signedUrl).toContain("r2.test");
});
```

- [ ] **Step 2: Run private-media tests and verify Supabase-specific assertions fail**

Run:

```bash
rtk bun test tests/project-media.test.ts tests/service-evidence.test.ts tests/service-installed-assets-batch.test.ts tests/service-technician-warranty-multipart.test.ts tests/service-customer-request-multipart.test.ts
```

Expected: FAIL because project-wide attachments do not exist and current routes call Supabase directly.

- [ ] **Step 3: Implement transaction-safe private upload helper**

For existing multipart endpoints, preserve validation and SHA-256 behavior but replace direct Supabase writes with:

```ts
const media = await mediaService.putManagedObject({
  storeId: gate.storeId,
  actorId: gate.userId,
  purpose: "service-evidence",
  fileName: file.name,
  mimeType: detectedMime,
  bytes,
  visibility: "private",
});
```

Insert the domain attachment and `media_object_id` in one database transaction. If the transaction fails, soft-delete the media row and enqueue R2 cleanup. Existing `bucket/path` columns receive the R2 bucket and object key during compatibility.

- [ ] **Step 4: Implement project-wide attachment list/upload/delete**

GET returns only active attachments where `project_id` matches the authorized project and `job_id`, `claim_id`, `asset_id`, and `request_id` are null. POST accepts one multipart file plus controlled `phase`, optional `caption`, and optional `documentId`; when `documentId` is present, validate that the handover document belongs to the same project/store and insert `service_handover_document_media`. Web/mobile upload multiple files by sending bounded parallel requests. DELETE soft-deletes only the selected project-level attachment and removes its explicit document association.

Add project attachments to the project-detail data contract without embedding long-lived private URLs; signed URLs are generated on request and expire after 15 minutes.

- [ ] **Step 5: Run private-media and existing service lifecycle tests**

Run:

```bash
rtk bun test tests/project-media.test.ts tests/service-evidence.test.ts tests/service-installed-assets-batch.test.ts tests/service-technician-warranty-multipart.test.ts tests/service-customer-request-multipart.test.ts tests/service-evidence-deletion.test.mjs
rtk bunx tsc --noEmit
```

Expected: PASS, including idempotent installed-device uploads, service locks, file limits, cross-store denial, and cleanup fallback.

- [ ] **Step 6: Commit private-media backend**

```bash
rtk git add src/lib/media src/lib/data/projects.ts src/app/api/mobile/services src/app/api/portal tests
rtk git commit -m "feat(projects): store private service media in R2"
```

### Task 7: Web project dossier and post-install upload experience

**Files:**
- Create: `luma-pos-web/src/app/(app)/projects/[id]/project-media-panel.tsx`
- Modify: `luma-pos-web/src/app/(app)/projects/[id]/project-redesigned-experience.tsx`
- Modify: `luma-pos-web/src/app/(app)/services/installed-asset-batch-create.tsx`
- Modify: `luma-pos-web/src/app/(app)/services/service-widgets.tsx`
- Test: `luma-pos-web/tests/project-media-ui.test.tsx`
- Modify: `luma-pos-web/messages/vi.json`
- Modify: `luma-pos-web/messages/en.json`

**Interfaces:**
- Consumes: Task 6 project attachment API.
- Produces: reusable `ProjectMediaPanel({ projectId, phaseFilter?, initialItems?, openUploadSignal? })`.

- [ ] **Step 1: Write failing UI behavior tests**

```tsx
test("finance tab renders project files and controlled phase filter", async () => {
  render(<ProjectMediaPanel projectId="project-1" initialItems={FILES} />);
  expect(screen.getByRole("button", { name: "Thêm ảnh hoặc tệp" })).toBeVisible();
  expect(screen.getByText("Nghiệm thu")).toBeVisible();
  expect(screen.queryByRole("combobox")).toBeNull();
});

test("post-install success opens uploader with after-install phase", async () => {
  render(<InstalledAssetBatchCreate {...PROPS} />);
  await completeBatch();
  await user.click(screen.getByRole("button", { name: "Thêm ảnh sau lắp đặt" }));
  expect(screen.getByText("Ảnh sau lắp đặt")).toBeVisible();
});
```

- [ ] **Step 2: Run UI tests and verify the panel is absent**

Run: `rtk bun test tests/project-media-ui.test.tsx`  
Expected: FAIL because `ProjectMediaPanel` does not exist.

- [ ] **Step 3: Build the shared web media panel**

Use Luma styled buttons/popovers, Lucide `Upload`, `Camera`, `Image`, `FileText`, `Download`, and `Trash2`, and no visible native `<select>` or `<datalist>`. The controlled phase picker contains:

```ts
const PROJECT_MEDIA_PHASES = [
  ["survey", "Khảo sát"],
  ["construction", "Thi công"],
  ["after_installation", "Sau lắp đặt"],
  ["acceptance", "Nghiệm thu"],
  ["handover", "Bàn giao"],
  ["other", "Khác"],
] as const;
```

Support multi-file selection, per-file progress/result, retry only failed files, image thumbnails, generic file cards, authorized open/download, and delete confirmation. The Finance/Files tab shows all phases; Aftercare defaults to `after_installation`, `acceptance`, and `handover`. Each handover record exposes `Thêm tệp` and passes its `documentId` to the shared uploader so files are both project-wide and explicitly linked to that record.

- [ ] **Step 4: Add the post-installation CTA without replacing the existing header/navigation**

After the installed-asset batch and per-device photos succeed, keep the success result visible and add `Thêm ảnh sau lắp đặt`. The CTA opens the common project uploader with phase `after_installation`; it does not create duplicate device attachments.

- [ ] **Step 5: Run UI, accessibility, and type checks**

Run:

```bash
rtk bun test tests/project-media-ui.test.tsx tests/service-installed-assets-batch.test.ts
rtk bunx tsc --noEmit
rtk bun run lint
```

Expected: PASS; picker keyboard navigation, opened-state behavior, multi-file progress, and failure retry are covered.

- [ ] **Step 6: Commit web project media UI**

```bash
rtk git add 'src/app/(app)/projects/[id]' 'src/app/(app)/services' messages tests/project-media-ui.test.tsx
rtk git commit -m "feat(projects): add shared project media dossier"
```

### Task 8: Flutter project dossier and post-install upload experience

**Files:**
- Modify: `luma-pos-mobile/lib/src/core/api/mobile_data_repository.dart`
- Modify: `luma-pos-mobile/lib/src/features/more/domain/project_detail.dart`
- Create: `luma-pos-mobile/lib/src/features/more/presentation/project_media_section.dart`
- Modify: `luma-pos-mobile/lib/src/features/more/presentation/project_detail_screen.dart`
- Modify: `luma-pos-mobile/test/features/more/project_detail_mapping_test.dart`
- Modify: `luma-pos-mobile/test/features/more/project_detail_screen_test.dart`
- Create: `luma-pos-mobile/test/features/more/project_media_section_test.dart`

**Interfaces:**
- Consumes: Task 6 API and existing `image_picker`, `LumaDesignIcon`, `LumaImage`, `showLumaModalSheet`.
- Produces: `ProjectMediaAttachment`, `ProjectMediaSection`, repository list/upload/delete methods.

- [ ] **Step 1: Write failing mapping and widget tests**

```dart
test('maps private project attachment without persisting signed URL as identity', () {
  final item = ProjectMediaAttachment.fromJson({
    'id': 'attachment-1',
    'mediaId': 'media-1',
    'phase': 'after_installation',
    'fileName': 'after.jpg',
    'mimeType': 'image/jpeg',
    'sizeBytes': 1200,
    'signedUrl': 'https://signed.test/after.jpg',
  });
  expect(item.mediaId, 'media-1');
  expect(item.isImage, isTrue);
});

testWidgets('uses approved design icons and opens common uploader', (tester) async {
  await pumpProject(tester);
  await tester.tap(find.byKey(const Key('project-tab-finance')));
  expect(find.byType(LumaDesignIcon), findsWidgets);
  await tester.tap(find.text('Thêm ảnh hoặc tệp'));
  expect(find.text('Hồ sơ công trình'), findsOneWidget);
  expect(find.byType(DropdownButton), findsNothing);
});
```

- [ ] **Step 2: Run Flutter project tests and verify missing models/widgets fail**

Run:

```bash
rtk flutter test test/features/more/project_detail_mapping_test.dart test/features/more/project_media_section_test.dart test/features/more/project_detail_screen_test.dart
```

Expected: FAIL because project media domain/UI is absent.

- [ ] **Step 3: Implement repository and project media model**

Repository methods use `/api/mobile/services/projects/:id/attachments`. Upload one selected file per request while exposing a batch state with `queued`, `uploading`, `complete`, or `failed`; retry sends only failed items.

- [ ] **Step 4: Implement the mobile dossier UI using existing components**

Use `LumaDesignIcon('plus')`, `LumaDesignIcon('camera')`, `LumaDesignIcon('image')`, `LumaDesignIcon('fileText')`, `LumaDesignIcon('download')`, and `LumaDesignIcon('trash')`. Use a full-screen `showLumaModalSheet(fullScreen: true)` with `LumaSheetFrame(fullScreen: true)` for the scroll-heavy multi-file workflow. Phase selection uses `LumaPickerField`; there is exactly one visible label. Preserve the existing project header and tab navigation.

After installed-asset batch success, `Thêm ảnh sau lắp đặt` opens the same uploader with `after_installation`. Project media appears in Aftercare and Finance/Files without duplicating per-device photos. A handover record's `Thêm tệp` action passes the record ID and the selected phase to the same full-screen uploader.

- [ ] **Step 5: Run widget, mapping, keyboard, and golden-sensitive tests**

Run:

```bash
rtk flutter test test/features/more/project_detail_mapping_test.dart test/features/more/project_media_section_test.dart test/features/more/project_detail_screen_test.dart
rtk flutter analyze
```

Expected: PASS with no new direct `showModalBottomSheet`, no native picker, and no replacement navigation/header.

- [ ] **Step 6: Commit Flutter project media UI**

```bash
rtk git add lib/src/core/api lib/src/features/more test/features/more
rtk git commit -m "feat(projects): add mobile project media dossier"
```

### Task 9: AI attachments and remaining managed-media call sites

**Files:**
- Modify: `luma-pos-web/src/app/api/mobile/ai/attachments/route.ts`
- Modify: `luma-pos-web/src/lib/ai/attachments.ts`
- Modify: `luma-pos-web/src/lib/schemas/settings.ts`
- Modify: `luma-pos-web/src/app/(app)/settings/settings-client.tsx`
- Modify: `luma-pos-web/tests/ai-tenant-scope.test.ts`
- Modify: `luma-pos-web/tests/ai-attachment-intent.test.mjs`
- Modify: `luma-pos-mobile/lib/src/features/more/presentation/ai_assistant_screen.dart`
- Modify: `luma-pos-mobile/test/widget_test.dart`

**Interfaces:**
- Consumes: media service private `ai-attachment` purpose.
- Produces: AI attachment JSON containing `mediaId` plus legacy `bucket/path/signedUrl` during compatibility.

- [ ] **Step 1: Add failing AI attachment persistence assertions**

```ts
expect(attachment).toMatchObject({
  mediaId: "media-ai-1",
  bucket: "lumapos-test-private-media",
  path: expect.stringContaining("/ai/"),
});
expect(attachment.signedUrl).toContain("X-Amz-Signature=");
expect(attachment.signedUrl).not.toContain("supabase.co/storage");
```

- [ ] **Step 2: Run AI tests and verify Supabase-specific implementation fails**

Run: `rtk bun test tests/ai-tenant-scope.test.ts tests/ai-attachment-intent.test.mjs`  
Expected: FAIL because AI uploads currently use the selected Supabase bucket.

- [ ] **Step 3: Route AI upload/download through the media service**

Persist `mediaId`, preserve old descriptor fields, and resolve legacy descriptors through the Supabase adapter. New attachments always use the R2 private bucket. Keep persisted chat attachments until chat deletion; pending uploads still expire after 24 hours.

Replace the editable Supabase bucket setting with a read-only `Cloudflare R2 (managed)` display. Retain the old preference only for resolving legacy AI attachments; do not silently ignore it while showing an active selector.

- [ ] **Step 4: Keep Flutter parsing backward- and forward-compatible**

Add nullable `mediaId` to `_ComposerAttachment`, serialize it for new messages, and keep parsing `bucket/path` for old sessions. No UI layout or icon change is required.

- [ ] **Step 5: Run AI and Flutter tests**

Run:

```bash
rtk bun test tests/ai-tenant-scope.test.ts tests/ai-attachment-intent.test.mjs
rtk bunx tsc --noEmit
rtk flutter test test/widget_test.dart --plain-name "AI attachment"
```

Expected: PASS and cross-tenant AI media resolution remains denied.

- [ ] **Step 6: Commit AI media migration**

```bash
rtk git add src/app/api/mobile/ai src/lib/ai src/lib/schemas/settings.ts 'src/app/(app)/settings' tests
rtk git commit -m "feat(ai): store attachments in R2"
```

```bash
rtk git add lib/src/features/more/presentation/ai_assistant_screen.dart test/widget_test.dart
rtk git commit -m "feat(ai): support managed media attachments"
```

### Task 10: Inventory, copy, verify, cutover, and rollback tooling

**Files:**
- Create: `luma-pos-web/src/lib/media/migration.ts`
- Create: `luma-pos-web/src/scripts/migrate-media-to-r2.ts`
- Modify: `luma-pos-web/package.json`
- Test: `luma-pos-web/tests/media-migration.test.ts`
- Create: `luma-pos-web/docs/media-r2-migration-runbook.md`

**Interfaces:**
- Consumes: both storage adapters, `mediaMigrationRuns`, `mediaMigrationItems`.
- Produces: `media:r2:inventory`, `media:r2:copy`, `media:r2:verify`, `media:r2:cutover`, `media:r2:rollback`, `media:r2:delete-source` commands.

- [ ] **Step 1: Write failing classification and idempotency tests**

```ts
test("classifies only Luma-owned Supabase URLs", () => {
  expect(classifyLegacyUrl(LUMA_PRODUCT_URL)).toEqual({ provider: "supabase", bucket: "products", key: PRODUCT_KEY });
  expect(classifyLegacyUrl("https://vendor.example/camera.jpg")).toBeNull();
});

test("copy rerun reuses the same migration item and R2 key", async () => {
  await migrateItem(INPUT);
  await migrateItem(INPUT);
  expect(fakeR2.puts).toHaveLength(1);
  expect(await countMigrationItems()).toBe(1);
});
```

- [ ] **Step 2: Run migration tests and verify missing functions fail**

Run: `rtk bun test tests/media-migration.test.ts`  
Expected: FAIL because migration core does not exist.

- [ ] **Step 3: Implement the resumable migration state machine**

Each item transitions through `inventoried → copied → verified → cutover → source_deleted`, with `quarantined` on size/hash mismatch. Inventory covers known Luma Supabase hosts/buckets in products, brand logo, service attachments, customer-request attachments, handover `photoUrls`, and AI descriptors. External URLs are recorded as skipped and never downloaded.

Copy streams source bytes, computes SHA-256, writes immutable R2 key, and stores source/target size and hash. Verify performs target `HEAD` plus hash verification before cutover. Cutover updates one bounded batch transaction and retains legacy coordinates. Rollback restores legacy resolution without copying R2 back.

- [ ] **Step 4: Add explicit CLI commands with dry-run default**

Package scripts:

```json
{
  "media:r2:inventory": "bun run src/scripts/migrate-media-to-r2.ts inventory --dry-run",
  "media:r2:copy": "bun run src/scripts/migrate-media-to-r2.ts copy --dry-run",
  "media:r2:verify": "bun run src/scripts/migrate-media-to-r2.ts verify --dry-run",
  "media:r2:cutover": "bun run src/scripts/migrate-media-to-r2.ts cutover --dry-run",
  "media:r2:rollback": "bun run src/scripts/migrate-media-to-r2.ts rollback --dry-run",
  "media:r2:delete-source": "bun run src/scripts/migrate-media-to-r2.ts delete-source --dry-run"
}
```

Mutation requires both `--execute` and `--run-id=<uuid>`. Source deletion additionally requires `--confirmed-after=<ISO timestamp>` at least 30 days after completed cutover and refuses runs with unresolved/quarantined items or fallback reads.

- [ ] **Step 5: Run migration tests and a local dry run**

Run:

```bash
rtk bun test tests/media-migration.test.ts
rtk bun run media:r2:inventory
rtk bunx tsc --noEmit
```

Expected: PASS; dry run prints counts and performs no writes to database or storage.

- [ ] **Step 6: Commit migration tooling and runbook**

```bash
rtk git add src/lib/media/migration.ts src/scripts/migrate-media-to-r2.ts package.json docs/media-r2-migration-runbook.md tests/media-migration.test.ts
rtk git commit -m "feat(media): add reversible R2 migration tooling"
```

### Task 11: Cleanup worker, lifecycle protection, and operational metrics

**Files:**
- Create: `luma-pos-web/src/lib/media/cleanup.ts`
- Create: `luma-pos-web/src/app/api/cron/media/cleanup/route.ts`
- Modify: `luma-pos-web/vercel.json`
- Test: `luma-pos-web/tests/media-cleanup.test.ts`
- Modify: `luma-pos-web/docs/media-r2-migration-runbook.md`

**Interfaces:**
- Consumes: media registry and provider adapters.
- Produces: `drainMediaCleanup()` and protected `GET /api/cron/media/cleanup`.

- [ ] **Step 1: Write failing lease/idempotency tests**

```ts
test("cleanup removes abandoned pending media after 24 hours", async () => {
  const result = await drainMediaCleanup({ now: NOW, batchSize: 50, storage: fakeStorage });
  expect(result.pendingExpired).toBe(1);
  expect(fakeStorage.removed).toEqual([{ bucket: PRIVATE_BUCKET, key: ABANDONED_KEY }]);
});

test("already missing object completes deletion without retry", async () => {
  fakeStorage.removeError = Object.assign(new Error("not found"), { name: "NoSuchKey" });
  const result = await drainMediaCleanup({ now: NOW, batchSize: 50, storage: fakeStorage });
  expect(result.failed).toBe(0);
});
```

- [ ] **Step 2: Run cleanup tests and verify missing worker fails**

Run: `rtk bun test tests/media-cleanup.test.ts`  
Expected: FAIL because cleanup worker does not exist.

- [ ] **Step 3: Implement bounded leased cleanup**

Claim at most 50 rows per run with a unique lease token. Clean pending rows older than 24 hours and soft-deleted unreferenced rows. Remove both `object_key` and `thumbnail_object_key` when present. Treat `NoSuchKey` as success, clear leases on success, and record attempt count/last error on failure. Never physically delete an object referenced by an active product, service attachment, handover document, or persisted AI chat.

- [ ] **Step 4: Protect and schedule the cron route**

Use `Authorization: Bearer ${CRON_SECRET}` with the same constant-time behavior as existing cron routes. Add:

```json
{
  "path": "/api/cron/media/cleanup",
  "schedule": "15 * * * *"
}
```

Return only aggregate counts/bytes; never return object keys, signed URLs, filenames, or tenant PII. Document the R2 bucket lifecycle rule that aborts incomplete multipart uploads after seven days, while application cleanup remains authoritative for ordinary objects.

- [ ] **Step 5: Run cleanup, cron-auth, and type tests**

Run:

```bash
rtk bun test tests/media-cleanup.test.ts
rtk bunx tsc --noEmit
```

Expected: PASS for unauthorized cron access, stale lease recovery, missing objects, referenced objects, and retry metadata.

- [ ] **Step 6: Commit cleanup and operations**

```bash
rtk git add src/lib/media/cleanup.ts src/app/api/cron/media vercel.json docs/media-r2-migration-runbook.md tests/media-cleanup.test.ts
rtk git commit -m "feat(media): add R2 cleanup operations"
```

### Task 12: End-to-end rollout verification and release gates

**Files:**
- Modify: `luma-pos-web/docs/media-r2-migration-runbook.md`
- Modify: `luma-pos-web/DEPLOY.md`
- Modify: `luma-pos-mobile/lib/src/core/release/production_release_preflight.dart`
- Modify: `luma-pos-mobile/test/release/production_release_preflight_test.dart`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: explicit R2 production readiness checks and operator release checklist.

- [ ] **Step 1: Write failing production preflight expectations**

```dart
test('production preflight reports managed media capability', () {
  final report = buildProductionReleasePreflight(config);
  expect(report.requiredCapabilities, contains('managed-media-r2-v1'));
});
```

Backend readiness must verify all six server variables are present, both buckets are reachable, and public base URL is HTTPS before enabling `MEDIA_WRITE_PROVIDER=r2`.

- [ ] **Step 2: Run preflight tests and verify capability is absent**

Run: `rtk flutter test test/release/production_release_preflight_test.dart`  
Expected: FAIL because the capability check is not defined.

- [ ] **Step 3: Add release gates and operator checks**

Document and enforce this order:

1. Deploy schema and dual-provider read support with R2 writes disabled.
2. Verify non-production buckets, CORS, signed PUT, private signed GET, public custom domain, and cleanup cron.
3. Enable product-image R2 writes and monitor 24 hours.
4. Enable project/service writes and monitor 48 hours.
5. Enable AI writes and monitor 24 hours.
6. Run migration inventory/copy/verify dry runs, then execute by bounded batches.
7. Enable R2-preferred reads and monitor Supabase fallbacks for 30 days.
8. Delete Supabase source objects only after all retirement gates pass.

- [ ] **Step 4: Run scoped web and mobile suites**

Run:

```bash
rtk bun test tests/media-storage.test.ts tests/media-schema.test.mjs tests/media-api.test.ts tests/media-image-variants.test.ts tests/media-upload-client.test.ts tests/mobile-product-image-upload-route.test.ts tests/project-media.test.ts tests/project-media-ui.test.tsx tests/ai-tenant-scope.test.ts tests/media-migration.test.ts tests/media-cleanup.test.ts
rtk bunx tsc --noEmit
rtk bun run lint
rtk flutter test test/core/media/media_upload_test.dart test/features/more/data/product_image_upload_test.dart test/features/more/project_detail_mapping_test.dart test/features/more/project_media_section_test.dart test/features/more/project_detail_screen_test.dart test/release/production_release_preflight_test.dart
rtk flutter analyze
```

Expected: all scoped checks PASS.

- [ ] **Step 5: Run broad suites and record pre-existing unrelated failures separately**

Run:

```bash
rtk bun run test
rtk bun run build
rtk flutter test
```

Expected: no regression attributable to managed media. Any pre-existing golden/UI failure must be listed with its existing baseline; do not update unrelated goldens to make the suite green.

- [ ] **Step 6: Commit release gates**

```bash
rtk git add docs/media-r2-migration-runbook.md DEPLOY.md
rtk git commit -m "docs(media): add R2 rollout gates"
```

```bash
rtk git add lib/src/core/release test/release
rtk git commit -m "chore(release): require managed media capability"
```

## Completion Definition

Implementation is complete only when:

- new product, project, service, installed-asset, warranty, customer-request, and AI uploads all write R2 objects;
- web and Flutter preserve existing business behavior and compatibility response fields;
- private cross-tenant access tests pass;
- migration inventory/copy/verify/cutover/rollback dry runs are idempotent;
- no Supabase source object has been deleted before the 30-day gate;
- repository authorship remains `cvthien <cvthien.dev@gmail.com>`;
- scoped verification, TypeScript, Flutter analyze, web build, and relevant tests have fresh passing evidence.
