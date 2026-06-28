import assert from "node:assert/strict";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { parseProductLines } = await import(`${PROJ}/src/lib/ai/actions.ts`);

function product(id, sku, name, baseUnit = "cái") {
  return {
    id,
    sku,
    name,
    baseUnit,
    costPrice: "0",
    lastPurchasePrice: "0",
    retailPrice: "1000",
  };
}

const products = [
  product("at-doi-32", "SP000956", "Át Cài Đôi Panasonic 2P2E - 32A", "Cái"),
  product("at-doi-25", "SP000961", "Át Cài Đôi Panasonic 2P2E - 25A", "Cái"),
  product("at-don-16", "SP001919", "Át Cài Đơn Panasonic 1P1E - 16A", "Cái"),
  product("at-don-20", "SP000952", "Át Cài Đơn Panasonic 1P1E - 20A", "Cái"),
  product("at-khoi-20", "SP000964", "Át Khối Panasonic - 20A", "Cái"),
  product("at-3p-32", "SP053080", "Át Cài 3 Pha Panasonic 3P3E - 32A", "Cái"),
  product("ct-pana-1", "SP053237", "Hạt Pana công tắc 1 chiều FULL WNV5001-7W", "Cái"),
  product("ct-pana-2", "SP000930", "Hạt Pana công tắc 2 chiều WIDE 5002 - 7SW", "Cái"),
  product("den-bao", "SP000931", "Hạt đèn báo màu NANOCO WIDE N302RW - Panasonic", "cái"),
  product("ocam-2", "SP052977", "Hạt ổ cắm 2 chấu DOBO A66-66019S", "cái"),
  product("ocam-3", "SP000874", "Ổ Cắm Lioa 3P-2D", "cái"),
  product("vit-bat-mat", "SP001533", "Vít bắt mặt ổ điện - 4*2", "KG"),
  product("to-vit", "SP001067", "Bộ Tô Vít JULEI", "cái"),
  product("quat-hut", "SP002763", "Quạt Hút Âm Trần GENUN - 20*20", "cái"),
  product("quat-treo", "SP001924", "Quạt Treo Tường Phong Lan 300 2 Dây", "cái"),
  product("den-24w", "SP002539", "Đèn Led Ốp Dưa - 24W", "Cái"),
  product("den-8w", "SP000846", "ĐÈN LED DOWNLIGHT ÂM TRẦN RẠNG ĐÔNG 90/8W", "cái"),
];

const prompt =
  "1 át đôi 32 A 1 at đơn16 A 3 át đôi 25A 1 át đơn 20 A " +
  "4 át đen 20A 4 dưỡng át 20 hạt công tắc pana 10hat đảo chiều " +
  "5 hạt đèn báo 50 hạt ổ cắm 1 hạt ổ cắm 3 chân 3 lang vít 4 bắt mặt " +
  "1 đèn ốp trần rang đông 24 w 2 quạt hút mùi âm trần " +
  "2 quạt treo tường nhà vệ sinh loại nhỏ 40 đèn âm trần 1 màu 8 w";

const lines = parseProductLines(prompt, products);
const byId = new Map(lines.map((line) => [line.product.id, line]));

assert.equal(byId.get("at-doi-32")?.quantity, 1);
assert.equal(byId.get("at-don-16")?.quantity, 1);
assert.equal(byId.get("at-doi-25")?.quantity, 3);
assert.equal(byId.get("at-don-20")?.quantity, 1);
assert.equal(byId.get("at-khoi-20")?.quantity, 4);
assert.equal(byId.get("ct-pana-1")?.quantity, 20);
assert.equal(byId.get("ct-pana-2")?.quantity, 10);
assert.equal(byId.get("den-bao")?.quantity, 5);
assert.equal(byId.get("vit-bat-mat")?.quantity, 4);
assert.equal(byId.get("quat-hut")?.quantity, 2);
assert.equal(byId.get("quat-treo")?.quantity, 2);
assert.equal(byId.get("den-24w")?.quantity, 1);
assert.equal(byId.get("den-8w")?.quantity, 40);

assert.equal(byId.has("at-3p-32"), false, "generic 'duong at' should not match 3 pha at");
assert.equal(byId.has("to-vit"), false, "generic 'lang vit' should not match screwdriver set");

console.log("ai pos fuzzy product line tests passed");
