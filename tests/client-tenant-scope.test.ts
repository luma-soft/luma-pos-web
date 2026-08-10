import { describe, expect, test } from "bun:test";
import {
  tenantStorageKey,
  tenantStoreId,
} from "@/components/ai-assistant/utils";

describe("client tenant storage scope", () => {
  test("same user and role receive different keys in different stores", () => {
    const storeA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:user-1:manager";
    const storeB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:user-1:manager";

    expect(tenantStorageKey("pos-invoices", storeA)).not.toBe(
      tenantStorageKey("pos-invoices", storeB),
    );
    expect(tenantStoreId(storeA)).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(tenantStoreId(storeB)).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });
});
