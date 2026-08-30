import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as serviceSchemas from "../src/lib/services/schemas";
import * as serviceEvidenceStorage from "../src/lib/services/evidence-storage";
import { resizeInstalledAssetProductDrafts } from "../src/lib/services/installed-asset-quantity";

const projectId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";

describe("installed asset batch input", () => {
  it("expands catalog quantity into independent drafts with stable unique ids", () => {
    const initial = [{ clientDraftId: "camera-unit-1", productId }];
    let nextId = 1;

    const expanded = resizeInstalledAssetProductDrafts({
      drafts: initial,
      productId,
      quantity: 3,
      createDraft: () => ({
        clientDraftId: `camera-unit-${++nextId}`,
        productId,
      }),
    });

    expect(expanded.drafts).toHaveLength(3);
    expect(expanded.removed).toEqual([]);
    expect(new Set(expanded.drafts.map((draft) => draft.clientDraftId)).size).toBe(3);
    expect(expanded.drafts.map((draft) => draft.productId)).toEqual([
      productId,
      productId,
      productId,
    ]);
  });

  it("caps catalog quantity at the 50-device API batch limit", () => {
    const otherDrafts = Array.from({ length: 49 }, (_, index) => ({
      clientDraftId: `other-${index}`,
      productId: `other-product-${index}`,
    }));
    const initial = [
      ...otherDrafts,
      { clientDraftId: "camera-unit-1", productId },
    ];

    const resized = resizeInstalledAssetProductDrafts({
      drafts: initial,
      productId,
      quantity: 3,
      createDraft: () => ({ clientDraftId: "should-not-be-created", productId }),
    });

    expect(resized.quantity).toBe(1);
    expect(resized.drafts).toHaveLength(50);
  });

  it("reports the exact common and per-device fields that block saving", () => {
    const validate = (
      serviceSchemas as typeof serviceSchemas & {
        validateInstalledAssetBatchDrafts?: (value: {
          locationLabel: string;
          installedOn: string;
          assets: Array<{
            clientDraftId: string;
            name: string;
            assetKind: string;
          }>;
        }) => {
          valid: boolean;
          issues: Array<Record<string, unknown>>;
          message: string;
        };
      }
    ).validateInstalledAssetBatchDrafts;

    expect(validate).toBeDefined();
    expect(validate?.({
      locationLabel: " ",
      installedOn: "",
      assets: [
        { clientDraftId: "camera-front", name: "", assetKind: "camera" },
        { clientDraftId: "nvr-rack", name: "Đầu ghi", assetKind: "" },
      ],
    })).toEqual({
      valid: false,
      issues: [
        {
          scope: "common",
          field: "locationLabel",
          fieldLabel: "Vị trí lắp đặt",
        },
        {
          scope: "common",
          field: "installedOn",
          fieldLabel: "Ngày lắp đặt",
        },
        {
          scope: "asset",
          clientDraftId: "camera-front",
          draftIndex: 0,
          field: "name",
          fieldLabel: "Tên thiết bị",
        },
        {
          scope: "asset",
          clientDraftId: "nvr-rack",
          draftIndex: 1,
          field: "assetKind",
          fieldLabel: "Loại thiết bị",
        },
      ],
      message: "Thông tin áp dụng chung: thiếu Vị trí lắp đặt, Ngày lắp đặt. Thiết bị 1: thiếu Tên thiết bị. Thiết bị 2: thiếu Loại thiết bị.",
    });
  });

  it("accepts multiple catalog-backed device drafts in one idempotent request", () => {
    const schema = (
      serviceSchemas as typeof serviceSchemas & {
        installedAssetBatchCreateSchema?: {
          safeParse: (value: unknown) => { success: boolean };
        };
      }
    ).installedAssetBatchCreateSchema;

    expect(schema).toBeDefined();
    expect(schema?.safeParse({
      projectId,
      requestId: "project-assets-20260828-001",
      assets: [
        {
          clientDraftId: "camera-front-door",
          productId,
          assetKind: "camera",
          name: "Camera cửa trước",
        },
        {
          clientDraftId: "nvr-rack",
          productId: "33333333-3333-4333-8333-333333333333",
          assetKind: "nvr",
          name: "Đầu ghi tại rack",
        },
      ],
    }).success).toBe(true);
  });

  it("rejects duplicate draft ids because retries must map deterministically", () => {
    const schema = (
      serviceSchemas as typeof serviceSchemas & {
        installedAssetBatchCreateSchema?: {
          safeParse: (value: unknown) => { success: boolean };
        };
      }
    ).installedAssetBatchCreateSchema;

    expect(schema).toBeDefined();
    expect(schema?.safeParse({
      projectId,
      requestId: "project-assets-20260828-002",
      assets: [
        {
          clientDraftId: "duplicate",
          assetKind: "camera",
          name: "Camera 1",
        },
        {
          clientDraftId: "duplicate",
          assetKind: "camera",
          name: "Camera 2",
        },
      ],
    }).success).toBe(false);
  });
});

describe("installed asset photo metadata", () => {
  it("accepts HEIC device evidence with deterministic ordering", () => {
    const schema = (
      serviceSchemas as typeof serviceSchemas & {
        serviceAssetAttachmentMetadataSchema?: {
          safeParse: (value: unknown) => { success: boolean };
        };
      }
    ).serviceAssetAttachmentMetadataSchema;

    expect(schema).toBeDefined();
    expect(schema?.safeParse({
      assetId: "44444444-4444-4444-8444-444444444444",
      category: "asset",
      clientRequestId: "asset-photo-camera-front-001",
      fileName: "camera-front.heic",
      mimeType: "image/heic",
      sizeBytes: 1_048_576,
      sortOrder: 2,
      isPrimary: true,
    }).success).toBe(true);
  });

  it("recognizes the ISO base media signature used by HEIC files", () => {
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70,
      0x68, 0x65, 0x69, 0x63,
      0x00, 0x00, 0x00, 0x00,
    ]);

    expect(serviceEvidenceStorage.sniffServiceEvidenceMime(bytes, "image/heic")).toBe("image/heic");
  });

  it("derives HEIC content type from the file name when the browser omits it", () => {
    const normalize = (
      serviceEvidenceStorage as typeof serviceEvidenceStorage & {
        serviceEvidenceDeclaredMime?: (fileName: string, declared: string) => string;
      }
    ).serviceEvidenceDeclaredMime;

    expect(normalize).toBeDefined();
    expect(normalize?.("camera-front.HEIC", "")).toBe("image/heic");
  });

  it("reports exactly how many photos exceed the per-device limit", () => {
    const capacity = (
      serviceEvidenceStorage as typeof serviceEvidenceStorage & {
        serviceEvidencePhotoCapacity?: (
          currentCount: number,
          incomingCount: number,
        ) => {
          acceptedCount: number;
          overflowCount: number;
          message: string;
        };
      }
    ).serviceEvidencePhotoCapacity;

    expect(capacity).toBeDefined();
    expect(capacity?.(7, 3)).toEqual({
      acceptedCount: 1,
      overflowCount: 2,
      message: "Mỗi thiết bị tối đa 8 ảnh. Đã bỏ qua 2 ảnh vượt giới hạn.",
    });
  });
});

describe("installed asset batch persistence contract", () => {
  it("keeps inventory mutations out of the installed-asset batch transaction", () => {
    const source = readFileSync("src/lib/actions/services.ts", "utf8");
    const batch = source.slice(
      source.indexOf("export async function createInstalledAssetsBatch"),
      source.indexOf("export async function updateInstalledAsset"),
    );

    expect(batch).not.toMatch(/stockLevels|stockMovements|inventoryMovements|usedQuantity|plannedQuantity/);
    expect(batch).toContain("clientRequestId");
    expect(batch).toContain("onConflictDoNothing");
  });

  it("checks project, job, product, and idempotency ownership inside the batch transaction", () => {
    const source = readFileSync("src/lib/actions/services.ts", "utf8");
    const batch = source.slice(
      source.indexOf("export async function createInstalledAssetsBatch"),
      source.indexOf("export async function updateInstalledAsset"),
    );
    const transaction = batch.slice(batch.indexOf("db.transaction"));

    expect(transaction).toContain("eq(projects.storeId, gate.storeId)");
    expect(transaction).toContain("eq(serviceJobs.storeId, gate.storeId)");
    expect(transaction).toContain("eq(products.storeId, gate.storeId)");
    expect(transaction).toContain("projectId: installedAssets.projectId");
    expect(transaction).toContain("asset.projectId !== value.projectId");
  });

  it("scopes serial and idempotency uniqueness by store", () => {
    const migration = readFileSync(
      "drizzle/0109_installed_asset_batch_and_photos.sql",
      "utf8",
    );

    expect(migration).toContain("installed_assets_store_serial_idx");
    expect(migration).toContain("installed_assets_store_request_idx");
    expect(migration).toContain("installed_assets_product_idx");
    expect(migration).toContain('("store_id", "client_request_id")');
    expect(migration).toContain("service_attachments_asset_primary_idx");
    expect(migration).toContain("service_attachments_asset_request_idx");
    expect(migration).toContain('("store_id", "asset_id", "client_request_id")');
  });

  it("makes each photo upload retry-safe with a client request id", () => {
    const route = readFileSync(
      "src/app/api/mobile/services/assets/[assetId]/attachments/route.ts",
      "utf8",
    );
    const webFlow = readFileSync(
      "src/app/(app)/services/installed-asset-batch-create.tsx",
      "utf8",
    );
    const mobileRepository = readFileSync(
      "../luma-pos-mobile/lib/src/core/api/mobile_data_repository.dart",
      "utf8",
    );

    expect(route).toContain("clientRequestId");
    expect(route).toContain("onConflictDoNothing");
    expect(route).toContain("putManagedObject");
    expect(route).toContain("mediaObjectId");
    expect(route).toContain("compensateManagedMediaAssociation");
    expect(route).not.toContain("upsert: true");
    expect(webFlow).toContain('form.set("clientRequestId", photo.id)');
    expect(mobileRepository).toContain("'clientRequestId': clientRequestId");
  });

  it("locks photo ordering after a partial upload so retry keeps the primary stable", () => {
    const webFlow = readFileSync(
      "src/app/(app)/services/installed-asset-batch-create.tsx",
      "utf8",
    );
    const primary = webFlow.slice(
      webFlow.indexOf("function makePrimaryPhoto"),
      webFlow.indexOf("function movePhoto"),
    );
    const reorder = webFlow.slice(
      webFlow.indexOf("function movePhoto"),
      webFlow.indexOf("async function submit"),
    );

    expect(primary).toContain("draft.photos.some((photo) => photo.uploaded)");
    expect(reorder).toContain("draft.photos.some((photo) => photo.uploaded)");
    expect(webFlow).toContain("photoOrderLocked");
  });

  it("enforces the eight-photo limit on the server under an asset row lock", () => {
    const route = readFileSync(
      "src/app/api/mobile/services/assets/[assetId]/attachments/route.ts",
      "utf8",
    );
    const post = route.slice(route.indexOf("export async function POST"));

    expect(post).toContain('.for("update")');
    expect(post).toContain("SERVICE_ASSET_PHOTO_LIMIT");
    expect(post).toContain("count(serviceAttachments.id)");
    expect(post).toContain("resolveAssetAttachmentUrl");
    expect(post).toContain("if (attachment.mediaObjectId !== managed.mediaId)");
    expect(post).toContain("id: attachment.id");
    expect(post).not.toContain("...legacyShape");
  });

  it("dual-reads legacy photos while signing canonical R2 objects for new uploads", () => {
    const route = readFileSync(
      "src/app/api/mobile/services/assets/[assetId]/attachments/route.ts",
      "utf8",
    );

    expect(route).toContain("resolveManagedPrivateMediaUrl");
    expect(route).toContain("expectedPurpose: target.purpose");
    expect(route).toContain("expectedTargetId: target.targetId");
    expect(route).toContain('purpose: "project-document" as const');
    expect(route).toContain("targetId: asset.projectId");
    expect(route).not.toContain('asset.jobId ? "service-evidence"');
    expect(route).toContain('getObjectStorage("supabase")');
    expect(route).toContain("expiresInSeconds: 15 * 60");
    expect(route).not.toContain("ensureServiceEvidenceBucket");
  });
});

describe("installed asset visual and interaction contract", () => {
  it("distinguishes loading, unavailable, empty, and ready catalog states", () => {
    const feedback = (
      serviceSchemas as typeof serviceSchemas & {
        installedAssetCatalogFeedback?: (
          status: "loading" | "cached" | "synced" | "unavailable",
          productCount: number,
        ) => {
          state: "loading" | "error" | "empty" | "ready";
          message: string;
          retryable: boolean;
        };
      }
    ).installedAssetCatalogFeedback;

    expect(feedback).toBeDefined();
    expect(feedback?.("loading", 0)).toEqual({
      state: "loading",
      message: "Đang tải danh mục sản phẩm…",
      retryable: false,
    });
    expect(feedback?.("unavailable", 0)).toEqual({
      state: "error",
      message: "Không thể tải danh mục sản phẩm.",
      retryable: true,
    });
    expect(feedback?.("synced", 0)).toEqual({
      state: "empty",
      message: "Không tìm thấy sản phẩm phù hợp.",
      retryable: false,
    });
    expect(feedback?.("cached", 3)).toEqual({
      state: "ready",
      message: "",
      retryable: false,
    });
  });

  it("keeps the web picker controlled, multi-select, and free of native selects", () => {
    const source = readFileSync(
      "src/app/(app)/services/installed-asset-batch-create.tsx",
      "utf8",
    );

    expect(source).toContain('aria-multiselectable="true"');
    expect(source).toContain("pickerOpen");
    expect(source).toContain("closeOnOutsideClick");
    expect(source).toContain('event.key !== "Escape"');
    expect(source).toContain("event.stopPropagation()");
    expect(source).toContain('event.key === "Enter" || event.key === " "');
    expect(source).toContain("Thêm {selectedProductCount} sản phẩm");
    expect(source).toContain("commonExpanded");
    expect(source).toContain('aria-controls="installed-asset-common-fields"');
    expect(source).not.toMatch(/<select|<datalist/);
  });

  it("uses the approved semantic icon systems on web and mobile", () => {
    const web = readFileSync(
      "src/app/(app)/services/installed-asset-batch-create.tsx",
      "utf8",
    );
    const mobilePath = "../luma-pos-mobile/lib/src/features/more/presentation/project_detail_screen.dart";
    const mobile = readFileSync(mobilePath, "utf8");
    const mobileFlow = mobile.slice(
      mobile.indexOf("enum _InstalledAssetSource"),
      mobile.indexOf("class _ProjectServiceTabBar"),
    );
    const mobileIcons = readFileSync(
      "../luma-pos-mobile/lib/src/core/icons/luma_design_icons.dart",
      "utf8",
    );

    for (const icon of [
      "PackageSearch",
      "FolderSearch",
      "SquarePen",
      "Search",
      "Check",
      "Info",
      "Plus",
      "Trash2",
      "ChevronUp",
      "ChevronDown",
      "X",
    ]) {
      expect(web).toContain(icon);
    }
    const sourceCard = web.slice(
      web.indexOf("function SourceCard"),
      web.indexOf("function ProductOption"),
    );
    expect(sourceCard).toContain(
      '<Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={3} />',
    );
    expect(sourceCard).toContain(
      '<Icon aria-hidden="true" className="h-7 w-7 shrink-0" strokeWidth={1.8} />',
    );
    for (const icon of [
      "packageSearch",
      "folderSearch",
      "edit",
      "infoCircle",
      "camera",
      "image",
      "trash",
      "chevronUp",
      "chevronDown",
      "calendar",
      "check",
      "circle",
      "x",
    ]) {
      expect(mobileFlow).toContain(`'${icon}'`);
      expect(mobileIcons).toContain(`'${icon}'`);
    }
    expect(mobileFlow).not.toContain("Icons.");
  });
});
