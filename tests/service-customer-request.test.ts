import { describe, expect, test } from "bun:test";
import {
  createCustomerRequestToken,
  hashCustomerRequestToken,
  isCustomerRequestTokenSubmittable,
  isCustomerRequestTokenViewable,
} from "../src/lib/services/customer-request-token";
import {
  calculateCustomerRequestSlaState,
  canTransitionCustomerRequest,
  sniffCustomerRequestEvidence,
  CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES,
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

  test("sniffs supported evidence from bytes and rejects spoofed/polyglot/truncated files", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0xff, 0xd9]);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
    const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");
    expect(sniffCustomerRequestEvidence(jpeg)?.mimeType).toBe("image/jpeg");
    expect(sniffCustomerRequestEvidence(png)?.mimeType).toBe("image/png");
    expect(sniffCustomerRequestEvidence(pdf)?.mimeType).toBe("application/pdf");
    expect(sniffCustomerRequestEvidence(new TextEncoder().encode("<script>alert(1)</script>"))).toBeNull();
    expect(sniffCustomerRequestEvidence(new TextEncoder().encode("%PDF-1.7\n<script>"))).toBeNull();
    expect(sniffCustomerRequestEvidence(Uint8Array.from([0x89, 0x50, 0x4e]))).toBeNull();
    expect(CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES).toBe(8 * 1024 * 1024);
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
});
