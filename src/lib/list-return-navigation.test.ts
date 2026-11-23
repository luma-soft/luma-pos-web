import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { forgetListLocations, rememberListLocation, withListFilters } from "./list-return-navigation";

afterEach(() => forgetListLocations());

describe("withListFilters", () => {
  it("returns href unchanged when nothing was remembered", () => {
    assert.equal(withListFilters("/sales?tab=orders&detailOrderId=a"), "/sales?tab=orders&detailOrderId=a");
  });

  it("carries list filters into the destination and drops overlays", () => {
    rememberListLocation("/sales", "tab=orders&q=abc&status=completed&detailOrderId=old&expanded=x");
    assert.equal(withListFilters("/sales?tab=orders&detailOrderId=new"), 
      "/sales?tab=orders&q=abc&status=completed&detailOrderId=new");
  });

  it("does not leak filters across tabs", () => {
    rememberListLocation("/sales", "tab=quotes&q=abc");
    assert.equal(withListFilters("/sales?tab=orders&detailOrderId=a"), "/sales?tab=orders&detailOrderId=a");
  });

  it("drops product editor ids but keeps other filters", () => {
    rememberListLocation("/inventory", "tab=products&status=inactive&productModal=edit&productId=p1");
    assert.equal(withListFilters("/inventory?tab=products"), "/inventory?tab=products&status=inactive");
  });
});
