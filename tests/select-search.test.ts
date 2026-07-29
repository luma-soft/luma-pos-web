import { describe, expect, test } from "bun:test";
import { matchesSelectSearch } from "@/components/ui/select";

describe("searchable select", () => {
  test("matches Vietnamese option labels without requiring accents", () => {
    expect(
      matchesSelectSearch("Đèn LED Downlight âm trần", "den led downlight"),
    ).toBe(true);
    expect(
      matchesSelectSearch("Bộ đèn chống ẩm", "chong am"),
    ).toBe(true);
    expect(
      matchesSelectSearch("Công tắc thông minh", "downlight"),
    ).toBe(false);
  });
});
