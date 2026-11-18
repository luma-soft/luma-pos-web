import { describe, expect, test } from "bun:test";
import { matchKiotVietDocuments } from "./kiotviet-link-documents.ts";

const at = (iso) => new Date(iso);
const source = (code, iso, amount, partner = "walk-in", exactPartner = null) => ({ code, at: at(iso), partner, exactPartner, amounts: [amount] });
const target = (code, iso, amount, partner = "walk-in", exactPartner = null) => ({ localId: code, code, at: at(iso), partner, exactPartner, amount });

describe("matchKiotVietDocuments", () => {
  test("links a POS order to the KiotViet invoice keyed in later the same day", () => {
    const result = matchKiotVietDocuments(
      [source("HD003415", "2026-11-12T10:14:00Z", 1_400_000, "c1")],
      [target("DH-261113-045734TP", "2026-11-13T04:57:00Z", 1_400_000, "c1")],
      3,
    );
    expect(result.linked.map((item) => [item.source.code, item.target.code])).toEqual([["HD003415", "DH-261113-045734TP"]]);
  });

  test("accepts rounding differences but holds a different amount for review", () => {
    const result = matchKiotVietDocuments(
      [source("HD003386", "2026-11-06T15:38:00Z", 5_036_720, "c1"), source("HD003384", "2026-11-07T15:36:00Z", 26_400_000, "c1")],
      [target("DHG-261106", "2026-11-06T11:17:00Z", 5_036_717, "c1"), target("DH-261106", "2026-11-06T17:02:00Z", 24_600_000, "c1")],
      3,
    );
    expect(result.linked.map((item) => item.source.code)).toEqual(["HD003386"]);
    expect(result.held.map((item) => item.source.code)).toEqual(["HD003384"]);
    expect(result.unmatched).toEqual([]);
  });

  test("pairs walk-in twins with their own walk-in record and resolves ties in later rounds", () => {
    const result = matchKiotVietDocuments(
      [
        source("HD003392", "2026-11-07T16:02:00Z", 550_000, "walk-in", "kh46"),
        source("HD003394", "2026-11-07T16:04:00Z", 550_000, "walk-in", null),
      ],
      [
        target("DH-A", "2026-11-07T08:26:00Z", 550_000, "walk-in", "kh46"),
        target("DH-B", "2026-11-07T10:10:00Z", 550_000, "walk-in", null),
      ],
      3,
    );
    expect(result.linked.map((item) => [item.source.code, item.target.code]).sort()).toEqual([["HD003392", "DH-A"], ["HD003394", "DH-B"]]);
  });

  test("leaves a document with no POS counterpart to be created", () => {
    const result = matchKiotVietDocuments(
      [source("PN001253", "2026-11-08T13:30:00Z", 4_911_224, "s60")],
      [target("PN-X", "2026-11-08T13:30:00Z", 4_911_224, "s2")],
      8,
    );
    expect(result.unmatched.map((item) => item.code)).toEqual(["PN001253"]);
  });

  test("never links across the time window", () => {
    const result = matchKiotVietDocuments(
      [source("HD1", "2026-11-01T00:00:00Z", 100_000)],
      [target("DH1", "2026-11-05T00:00:00Z", 100_000)],
      3,
    );
    expect(result.linked).toEqual([]);
  });
});
