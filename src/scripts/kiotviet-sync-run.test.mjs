import { describe, expect, test } from "bun:test";
import { matchExistingPosProducts } from "./kiotviet-sync-run.ts";

const kv = (kiotvietSku, name, baseUnit = "Cái", hasAttributes = false) => ({ kiotvietSku, name, baseUnit, hasAttributes });
const pos = (sku, name, baseUnit = "cái") => ({ sku, name, baseUnit });

describe("matchExistingPosProducts", () => {
  test("links a KiotViet product to the POS product created first (case and spacing ignored)", () => {
    const result = matchExistingPosProducts(
      [kv("SP053475", "Quạt trần SUNHOUSE 5 cánh  màu trắng APF7669W")],
      [pos("SPMU5J3S9B089", "quạt trần SUNHOUSE 5 cánh màu trắng APF7669W")],
    );
    expect([...result.links]).toEqual([["SP053475", "SPMU5J3S9B089"]]);
    expect(result.held).toEqual([]);
  });

  test("leaves a genuinely new product to be created", () => {
    const result = matchExistingPosProducts([kv("SP060000", "Ổ cắm mới")], [pos("SPMA", "Công tắc")]);
    expect(result.links.size).toBe(0);
    expect(result.held).toEqual([]);
  });

  test("holds look-alikes instead of guessing", () => {
    const result = matchExistingPosProducts(
      [
        kv("SP1", "Vợt Muỗi"),
        kv("SP2", "Dây Điện KIASUNG", "m"), kv("SP3", "Dây Điện KIASUNG", "m"),
        kv("SP4", "Chổi Sơn Nhựa", "Cái", true),
        kv("SP5", "Bộ dây bát sen vỉ", "Bộ"),
      ],
      [
        pos("SPMV1", "Vợt muỗi"), pos("SPMV2", "Vợt muỗi"),
        pos("SPMK", "Dây điện KIASUNG", "m"),
        pos("SPMC", "Chổi sơn nhựa"),
        pos("SPMB", "Bộ dây bát sen vỉ", "cái"),
      ],
    );
    expect(result.links.size).toBe(0);
    expect(result.held.map((item) => [item.kiotvietSku, item.reason])).toEqual([
      ["SP1", "POS có nhiều sản phẩm cùng tên"],
      ["SP2", "nhiều sản phẩm KiotViet mới cùng tên"],
      ["SP3", "nhiều sản phẩm KiotViet mới cùng tên"],
      ["SP4", "sản phẩm KiotViet có thuộc tính, POS có sản phẩm cùng tên"],
      ["SP5", "POS có sản phẩm cùng tên nhưng khác ĐVT"],
    ]);
  });
});
