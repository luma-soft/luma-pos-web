import { expect, test } from "bun:test";
import { sanitizePrintRichText } from "./rich-text";

test("keeps supported rich-text formatting", () => {
  const html = sanitizePrintRichText('<h3 style="text-align: center; color: red">Hải Đăng</h3><p><strong>Thiết bị</strong> <em>nhà bếp</em> <u>cao cấp</u></p><ul><li>Một</li></ul>');

  expect(html).toContain('<h3 style="text-align:center">Hải Đăng</h3>');
  expect(html).toContain("<strong>Thiết bị</strong>");
  expect(html).toContain("<em>nhà bếp</em>");
  expect(html).toContain("<u>cao cấp</u>");
  expect(html).toContain("<ul><li>Một</li></ul>");
  expect(html).not.toContain("color");
});

test("keeps only supported relative font sizes", () => {
  expect(sanitizePrintRichText('<font size="2">Nhỏ</font><font size="4">Lớn</font>'))
    .toBe('<span style="font-size:0.85em">Nhỏ</span><span style="font-size:1.2em">Lớn</span>');
  expect(sanitizePrintRichText('<span style="font-size:99px" onclick="bad()">X</span>'))
    .toBe("<span>X</span>");
});

test("removes scripts, event handlers, links, and unsafe embedded content", () => {
  const html = sanitizePrintRichText('<script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">Bấm</a><p onclick="alert(4)">An toàn</p>');

  expect(html).not.toContain("script");
  expect(html).not.toContain("img");
  expect(html).not.toContain("href");
  expect(html).not.toContain("onclick");
  expect(html).toContain("Bấm");
  expect(html).toContain("<p>An toàn</p>");
});

test("escapes plain text while preserving line breaks as text", () => {
  expect(sanitizePrintRichText("Hải Đăng\n<không phải thẻ>")).toBe("Hải Đăng\n");
});
