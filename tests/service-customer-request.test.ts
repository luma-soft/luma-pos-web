import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import {
  createCustomerRequestToken,
  hashCustomerRequestToken,
  isCustomerRequestTokenSubmittable,
  isCustomerRequestTokenViewable,
} from "../src/lib/services/customer-request-token";
import {
  calculateCustomerRequestSlaState,
  canTransitionCustomerRequest,
  sanitizeCustomerRequestEvidence,
  CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES,
  CUSTOMER_REQUEST_EVIDENCE_MAX_DIMENSION,
  CUSTOMER_REQUEST_EVIDENCE_MAX_PIXELS,
} from "../src/lib/services/customer-request-portal";

describe("customer service request token", () => {
  test("creates an opaque token and stores only a stable hash", () => {
    const token = createCustomerRequestToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(hashCustomerRequestToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCustomerRequestToken(token)).toBe(hashCustomerRequestToken(token));
  });

  test("submission is one-time while status remains viewable until expiry", () => {
    const now = new Date("2026-07-29T00:00:00.000Z");
    expect(isCustomerRequestTokenSubmittable({
      status: "new",
      submittedAt: null,
      expiresAt: new Date("2026-07-30T00:00:00.000Z"),
      now,
    })).toBe(true);
    expect(isCustomerRequestTokenSubmittable({
      status: "new",
      submittedAt: new Date("2026-07-29T01:00:00.000Z"),
      expiresAt: new Date("2026-07-30T00:00:00.000Z"),
      now,
    })).toBe(false);
    expect(isCustomerRequestTokenViewable({
      expiresAt: new Date("2026-07-30T00:00:00.000Z"),
      now,
    })).toBe(true);
    expect(isCustomerRequestTokenViewable({
      status: "new",
      expiresAt: new Date("2026-07-28T00:00:00.000Z"),
      now,
    })).toBe(false);
  });

  test("fully decodes and canonicalizes real JPEG, PNG, and WebP photos", async () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const pipeline = sharp({
        create: { width: 12, height: 9, channels: 3, background: "#42a5f5" },
      });
      const input = await pipeline[format]().toBuffer();
      const result = await sanitizeCustomerRequestEvidence({
        bytes: input,
        declaredMimeType: `image/${format}`,
        fileName: `camera.${format === "jpeg" ? "jpg" : format}`,
      });
      expect(result?.mimeType).toBe(`image/${format}`);
      expect(result?.width).toBe(12);
      expect(result?.height).toBe(9);
      expect(result?.bytes.length).toBeGreaterThan(10);
      expect(result?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect((await sharp(result!.bytes).metadata()).format).toBe(format);
    }
  });

  test("rejects truncated, disguised, wrong-type, trailing polyglot, and oversized photos", async () => {
    const jpeg = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#111111" },
    }).jpeg().toBuffer();
    const svg = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`);
    const zipWrapped = Uint8Array.from([0xff, 0xd8, ...new TextEncoder().encode("PK\u0003\u0004payload"), 0xff, 0xd9]);
    await expect(sanitizeCustomerRequestEvidence({
      bytes: jpeg.subarray(0, jpeg.length - 8),
      declaredMimeType: "image/jpeg",
      fileName: "camera.jpg",
    })).resolves.toBeNull();
    await expect(sanitizeCustomerRequestEvidence({
      bytes: Uint8Array.from([0xff, 0xd8, ...svg, 0xff, 0xd9]),
      declaredMimeType: "image/jpeg",
      fileName: "camera.jpg",
    })).resolves.toBeNull();
    await expect(sanitizeCustomerRequestEvidence({
      bytes: zipWrapped,
      declaredMimeType: "image/jpeg",
      fileName: "camera.jpg",
    })).resolves.toBeNull();
    await expect(sanitizeCustomerRequestEvidence({
      bytes: Uint8Array.from([...jpeg, ...new TextEncoder().encode("<html>tail</html>")]),
      declaredMimeType: "image/jpeg",
      fileName: "camera.jpg",
    })).resolves.toBeNull();
    await expect(sanitizeCustomerRequestEvidence({
      bytes: jpeg,
      declaredMimeType: "image/png",
      fileName: "camera.png",
    })).resolves.toBeNull();
    await expect(sanitizeCustomerRequestEvidence({
      bytes: jpeg,
      declaredMimeType: "image/jpeg",
      fileName: "camera.pdf",
    })).resolves.toBeNull();
    const huge = await sharp({
      create: {
        width: CUSTOMER_REQUEST_EVIDENCE_MAX_DIMENSION + 1,
        height: 1,
        channels: 3,
        background: "#000000",
      },
    }).png().toBuffer();
    await expect(sanitizeCustomerRequestEvidence({
      bytes: huge,
      declaredMimeType: "image/png",
      fileName: "huge.png",
    })).resolves.toBeNull();
    const decompressionBomb = await sharp({
      create: {
        width: 4500,
        height: 4500,
        channels: 3,
        background: "#000000",
      },
    }).png().toBuffer();
    expect(decompressionBomb.length).toBeLessThan(CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES);
    await expect(sanitizeCustomerRequestEvidence({
      bytes: decompressionBomb,
      declaredMimeType: "image/png",
      fileName: "compressed.png",
    })).resolves.toBeNull();
    expect(CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES).toBe(8 * 1024 * 1024);
    expect(CUSTOMER_REQUEST_EVIDENCE_MAX_PIXELS).toBeLessThanOrEqual(20_000_000);
  });

  test("reports response and resolution SLA independently", () => {
    const now = new Date("2026-07-29T03:00:00.000Z");
    expect(calculateCustomerRequestSlaState({
      now,
      responseDueAt: new Date("2026-07-29T02:00:00.000Z"),
      resolutionDueAt: new Date("2026-07-29T05:00:00.000Z"),
      respondedAt: null,
      resolvedAt: null,
    })).toEqual({ responseOverdue: true, resolutionOverdue: false });
    expect(calculateCustomerRequestSlaState({
      now,
      responseDueAt: new Date("2026-07-29T02:00:00.000Z"),
      resolutionDueAt: new Date("2026-07-29T02:30:00.000Z"),
      respondedAt: new Date("2026-07-29T01:00:00.000Z"),
      resolvedAt: null,
    })).toEqual({ responseOverdue: false, resolutionOverdue: true });
  });

  test("requires triage before scheduling and a linked job for operational states", () => {
    expect(canTransitionCustomerRequest("new", "triaged", false)).toBe(true);
    expect(canTransitionCustomerRequest("new", "scheduled", true)).toBe(false);
    expect(canTransitionCustomerRequest("triaged", "scheduled", false)).toBe(false);
    expect(canTransitionCustomerRequest("triaged", "scheduled", true)).toBe(true);
    expect(canTransitionCustomerRequest("resolved", "closed", true)).toBe(true);
    expect(canTransitionCustomerRequest("closed", "in_progress", true)).toBe(false);
  });

  test("public page does not hydrate stored contact PII into client props", () => {
    const page = readFileSync(new URL("../src/app/portal/service-request/[token]/page.tsx", import.meta.url), "utf8");
    expect(page).not.toContain("serviceCustomerRequests.contactName");
    expect(page).not.toContain("serviceCustomerRequests.contactPhone");
    expect(page).not.toContain("serviceCustomerRequests.title");
    expect(page).not.toContain("defaultContactName");
    expect(page).not.toContain("defaultContactPhone");
  });

  test("public limits do not trust rotatable forwarding headers or create guessed-token buckets", () => {
    const route = readFileSync(new URL("../src/app/api/portal/service-request/[token]/route.ts", import.meta.url), "utf8");
    const page = readFileSync(new URL("../src/app/portal/service-request/[token]/page.tsx", import.meta.url), "utf8");
    for (const source of [route, page]) {
      expect(source).not.toContain("x-forwarded-for");
      expect(source).not.toContain("x-real-ip");
      expect(source).not.toContain("cf-connecting-ip");
      expect(source).toContain("global");
      expect(source).toContain("token:");
    }
    expect(route.indexOf("if (!current ||")).toBeLessThan(
      route.indexOf("customer-request:submit:token:"),
    );
  });
});
