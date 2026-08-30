import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AutoLinkText } from "@/components/ui/auto-link-text";

describe("AutoLinkText", () => {
  test("opens embedded HTTP links in a new tab without changing surrounding text", () => {
    const html = renderToStaticMarkup(
      <AutoLinkText>
        Nguồn: https://example.com/products/1?variant=blue, xem thêm.
      </AutoLinkText>,
    );

    expect(html).toContain("Nguồn: ");
    expect(html).toContain(
      'href="https://example.com/products/1?variant=blue"',
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("</a>, xem thêm.");
  });

  test("leaves unsupported protocols as plain text", () => {
    const html = renderToStaticMarkup(
      <AutoLinkText>
        Không mở javascript:alert(1) hoặc ftp://example.com/file.
      </AutoLinkText>,
    );

    expect(html).not.toContain("<a");
    expect(html).toContain("javascript:alert(1)");
    expect(html).toContain("ftp://example.com/file");
  });

  test("allows long URLs to wrap inside constrained detail cells", () => {
    const html = renderToStaticMarkup(
      <AutoLinkText>
        https://example.com/catalog/products/a-very-long-unbroken-product-image-identifier.jpg
      </AutoLinkText>,
    );
    const linkClasses = html
      .match(/<a[^>]*class="([^"]+)"/)?.[1]
      .split(" ");

    expect(linkClasses).toContain("max-w-full");
    expect(linkClasses).toContain("[overflow-wrap:anywhere]");
  });
});
