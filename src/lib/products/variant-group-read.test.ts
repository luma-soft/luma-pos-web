import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { projectVariantGroup } from "./variant-group-read";

const catalog = [{ id: "version", name: "Phiên bản", aliases: ["Model"] }];
const member = (id: string, value: string, stock = "0") => ({ id, sku: `RAP(${value})`, specs: { "Phiên bản": [value] }, baseUnit: "cái", totalStock: stock, costPrice: "990000", retailPrice: "1190000" });

describe("variant group read model", () => {
  it("keeps actual E/F identities, own stock and aggregate", () => {
    const e = { ...member("e", "E"), costPrice: "1280000", retailPrice: "1490000" };
    const f = member("f", "F", "2");
    const group = projectVariantGroup({ id: "root", name: "RAP2200", kind: "native", catalog, members: [e, f] });
    assert.equal(group.count, 2);
    assert.equal(group.totalStock, "2");
    assert.equal(group.minCostPrice, "990000");
    assert.equal(group.maxRetailPrice, "1490000");
    assert.deepEqual(group.members.map((row) => [row.id, row.totalStock]), [["e", "0"], ["f", "2"]]);
    assert.equal(group.requiresReview, false);
  });

  it("excludes missing imported combinations without synthesizing SKUs", () => {
    const members = [{ ...member("a", "E"), specs: { "Phiên bản": ["E"], Size: ["S"] } }, { ...member("b", "F"), specs: { "Phiên bản": ["F"], Size: ["L"] } }];
    const group = projectVariantGroup({ id: "a", name: "Imported", kind: "related", catalog, members });
    assert.equal(group.members.length, 2);
    assert.equal(group.excludedCombinationKeys.length, 2);
    assert.deepEqual(members[0].specs, { "Phiên bản": ["E"], Size: ["S"] });
  });

  it("catalog rename keeps stored attribute and value IDs", () => {
    const first = projectVariantGroup({ id: "root", name: "RAP", kind: "native", catalog, members: [member("e", "E"), member("f", "F")] });
    const next = projectVariantGroup({ id: first.id, name: first.name, kind: first.kind, catalog: [{ id: "version", name: "Phiên bản mới", aliases: ["Phiên bản"] }], members: [member("e", "E"), member("f", "F")], stored: first });
    assert.equal(next.attributes[0].name, "Phiên bản mới");
    assert.equal(next.members[0].combinationKey, first.members[0].combinationKey);
    assert.equal(next.requiresReview, false);
  });

  it("flags missing, multivalued and duplicate selections while retaining their products", () => {
    for (const other of [{ ...member("b", "E"), specs: {} }, { ...member("b", "E"), specs: { "Phiên bản": ["E", "F"] } }, member("b", "E")]) {
      const group = projectVariantGroup({ id: "root", name: "RAP", kind: "native", catalog, members: [member("a", "E"), other] });
      assert.equal(group.requiresReview, true);
      assert.equal(group.members.length, 2);
    }
  });

  it("does not sum unrelated units or truncate large legacy groups", () => {
    const group = projectVariantGroup({ id: "root", name: "Legacy", kind: "related", catalog, members: Array.from({ length: 241 }, (_, index) => ({ ...member(String(index), String(index), "1"), baseUnit: index === 0 ? "m" : "cây" })) });
    assert.equal(group.count, 241);
    assert.equal(group.totalStock, null);
    assert.equal(group.members.length, 241);
    assert.equal(group.requiresReview, false);
    assert.equal(group.excludedCombinationKeys.length, 0);
  });
});
