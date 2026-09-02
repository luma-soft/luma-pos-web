import { describe, expect, mock, test } from "bun:test";
import { NEW_STORE_FEATURE_DEFAULTS } from "../src/lib/tenancy/store-features";

mock.module("@/db", () => ({ db: {} }));

const { createMediaTargetAuthorizer } = await import(
  "../src/lib/media/authorization"
);
const { uploadIntentSchema } = await import("../src/lib/media/schemas");
const {
  LIBRARY_DOCUMENT_MAX_BYTES,
  LIBRARY_IMAGE_MAX_BYTES,
  LIBRARY_VIDEO_MAX_BYTES,
  mediaLibraryItemInputSchema,
} = await import("../src/lib/media/library-schema");

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_STORE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

const repository = {
  productExists: async () => false,
  getProject: async () => null,
  technicianCanAccessProject: async () => false,
  getServiceJob: async () => null,
  technicianAssignedToJob: async () => false,
  ownsAiSession: async () => false,
};

function actor(role: "owner" | "manager" | "cashier" | "warehouse" | "technician") {
  return {
    storeId: STORE_ID,
    userId: USER_ID,
    role,
    features: NEW_STORE_FEATURE_DEFAULTS,
  };
}

function upload(mimeType: string, sizeBytes: number) {
  return {
    purpose: "library-asset",
    targetId: STORE_ID,
    fileName: `mau.${mimeType === "video/mp4" ? "mp4" : mimeType === "application/pdf" ? "pdf" : "jpg"}`,
    mimeType,
    sizeBytes,
  };
}

describe("media library upload policy", () => {
  test("accepts bounded image, video and quotation documents", () => {
    expect(uploadIntentSchema.safeParse(upload("image/jpeg", LIBRARY_IMAGE_MAX_BYTES)).success).toBe(true);
    expect(uploadIntentSchema.safeParse(upload("video/mp4", LIBRARY_VIDEO_MAX_BYTES)).success).toBe(true);
    expect(uploadIntentSchema.safeParse(upload("application/pdf", LIBRARY_DOCUMENT_MAX_BYTES)).success).toBe(true);
  });

  test("applies a separate limit for each library media kind", () => {
    expect(uploadIntentSchema.safeParse(upload("image/jpeg", LIBRARY_IMAGE_MAX_BYTES + 1)).success).toBe(false);
    expect(uploadIntentSchema.safeParse(upload("video/mp4", LIBRARY_VIDEO_MAX_BYTES + 1)).success).toBe(false);
    expect(uploadIntentSchema.safeParse(upload("application/pdf", LIBRARY_DOCUMENT_MAX_BYTES + 1)).success).toBe(false);
  });

  test("rejects executable and unapproved video formats", () => {
    expect(uploadIntentSchema.safeParse(upload("application/x-msdownload", 1024)).success).toBe(false);
    expect(uploadIntentSchema.safeParse(upload("video/x-msvideo", 1024)).success).toBe(false);
  });
});

describe("media library metadata", () => {
  test("normalizes album, title, note and tags", () => {
    const parsed = mediaLibraryItemInputSchema.parse({
      mediaId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      album: "  Đèn trang trí  ",
      title: "  Đèn thả bàn ăn  ",
      note: "  Ánh sáng vàng  ",
      tags: [" phòng khách ", "đèn", "ĐÈN", ""],
    });
    expect(parsed).toEqual({
      mediaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      album: "Đèn trang trí",
      title: "Đèn thả bàn ăn",
      note: "Ánh sáng vàng",
      tags: ["phòng khách", "đèn"],
    });
  });

  test("uses the unclassified album when album is blank", () => {
    const parsed = mediaLibraryItemInputSchema.parse({
      mediaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      album: " ",
      title: "Báo giá tháng 9",
    });
    expect(parsed.album).toBe("Chưa phân loại");
  });
});

describe("media library target authorization", () => {
  const authorize = createMediaTargetAuthorizer(repository);

  test("lets managers create and resolve store-owned library uploads", async () => {
    await expect(authorize({
      actor: actor("manager"),
      purpose: "library-asset",
      targetId: STORE_ID,
    })).resolves.toBe("allowed");
  });

  test("denies non-managers and conceals another store coordinate", async () => {
    await expect(authorize({
      actor: actor("cashier"),
      purpose: "library-asset",
      targetId: STORE_ID,
    })).resolves.toBe("forbidden");
    await expect(authorize({
      actor: actor("owner"),
      purpose: "library-asset",
      targetId: OTHER_STORE_ID,
    })).resolves.toBe("not_found");
  });
});
