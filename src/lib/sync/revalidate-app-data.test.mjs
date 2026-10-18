import { expect, mock, test } from "bun:test";

const calls = [];
mock.module("next/cache", () => ({
  revalidatePath: (...args) => calls.push(args),
}));
const { revalidateAppData, revalidateAppDataPage } = await import("./revalidate-app-data");

test("app data invalidation refreshes the authenticated layout by default", () => {
  calls.length = 0;

  revalidateAppData("/inventory");

  expect(calls).toEqual([
    ["/inventory", undefined],
    ["/(app)", "layout"],
  ]);
});

test("page-scoped invalidation leaves the authenticated layout mounted", () => {
  calls.length = 0;

  revalidateAppDataPage("/inventory");

  expect(calls).toEqual([["/inventory", undefined]]);
});

test("explicit authenticated-layout invalidation is not duplicated", () => {
  calls.length = 0;

  revalidateAppData("/(app)", "layout");

  expect(calls).toEqual([["/(app)", "layout"]]);
});
