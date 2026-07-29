import { describe, expect, test } from "bun:test";
import {
  canonicalizeSignedDocument,
  hashSignedDocument,
} from "../src/lib/services/evidence";

describe("service signature evidence", () => {
  test("canonical document output is stable across object key order", () => {
    const first = canonicalizeSignedDocument({
      jobId: "job-1",
      content: { accepted: true, note: "Bàn giao đủ" },
    });
    const second = canonicalizeSignedDocument({
      content: { note: "Bàn giao đủ", accepted: true },
      jobId: "job-1",
    });

    expect(first).toBe(second);
    expect(hashSignedDocument(first)).toBe(hashSignedDocument(second));
  });

  test("document hash changes when signed content changes", () => {
    const first = hashSignedDocument(canonicalizeSignedDocument({ jobId: "job-1", accepted: true }));
    const second = hashSignedDocument(canonicalizeSignedDocument({ jobId: "job-1", accepted: false }));

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});
