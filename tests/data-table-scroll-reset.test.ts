import { describe, expect, test } from "bun:test";
import * as dataTableModule from "@/components/data-table";

describe("data table result scrolling", () => {
  test("moves a reused result table back to its first row without changing horizontal position", () => {
    const resetDataTableScroll = (
      dataTableModule as Record<string, unknown>
    ).resetDataTableScroll;
    const scrollRegion = { scrollTop: 640, scrollLeft: 120 };

    expect(typeof resetDataTableScroll).toBe("function");
    (resetDataTableScroll as (region: typeof scrollRegion) => void)(scrollRegion);

    expect(scrollRegion.scrollTop).toBe(0);
    expect(scrollRegion.scrollLeft).toBe(120);
  });

  test("treats search and pagination as a new result set but ignores row detail state", () => {
    const dataTableResultSetKey = (dataTableModule as Record<string, unknown>)
      .dataTableResultSetKey;
    expect(typeof dataTableResultSetKey).toBe("function");

    const getKey = dataTableResultSetKey as (
      params: URLSearchParams,
      expandedParam: string,
    ) => string;
    const firstPage = getKey(
      new URLSearchParams("q=camera&page=1&expanded=product-1"),
      "expanded",
    );

    expect(
      getKey(
        new URLSearchParams("q=camera&page=1&expanded=product-2"),
        "expanded",
      ),
    ).toBe(firstPage);
    expect(
      getKey(new URLSearchParams("q=camera&page=2"), "expanded"),
    ).not.toBe(firstPage);
    expect(
      getKey(new URLSearchParams("q=recorder&page=1"), "expanded"),
    ).not.toBe(firstPage);
  });
});
