import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { PartnerDetailLink } from "./partner-detail-link.tsx";

describe("partner detail links", () => {
  for (const kind of ["customer", "supplier"]) {
    const queryKey = kind === "customer" ? "detailCustomerId" : "detailSupplierId";

    test(`${kind} opens the correct modal URL in a new tab`, () => {
      const html = renderToStaticMarkup(createElement(PartnerDetailLink, { kind, partnerId: "partner-1", name: "Tên đối tác" }));
      expect(html).toContain(`href="/partners?tab=${kind}s&amp;${queryKey}=partner-1"`);
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).toContain("Tên đối tác");
    });

    test(`${kind} safely encodes its ID`, () => {
      const html = renderToStaticMarkup(createElement(PartnerDetailLink, { kind, partnerId: "id/&?x=1", name: "Tên đối tác" }));
      expect(html).toContain(`${queryKey}=id%2F%26%3Fx%3D1`);
    });
  }

  test("does not turn missing IDs into links", () => {
    for (const partnerId of [null, undefined, ""]) {
      expect(renderToStaticMarkup(createElement(PartnerDetailLink, { kind: "customer", partnerId, name: "Khách lẻ" }))).toBe("Khách lẻ");
    }
  });

  test("click and keyboard activation do not activate the parent record", () => {
    const link = PartnerDetailLink({ kind: "customer", partnerId: "customer-1", name: "Anh Nhật" });
    let stopped = 0;
    let prevented = 0;
    const event = { stopPropagation: () => { stopped += 1; }, preventDefault: () => { prevented += 1; } };
    link.props.onClick(event);
    link.props.onKeyDown({ ...event, key: "Enter" });
    expect(stopped).toBe(2);
    expect(prevented).toBe(0);
  });

  test("Escape still reaches the containing modal's dismiss handler", () => {
    const link = PartnerDetailLink({ kind: "customer", partnerId: "customer-1", name: "Anh Nhật" });
    let stopped = false;
    link.props.onKeyDown({ key: "Escape", stopPropagation: () => { stopped = true; } });
    expect(stopped).toBe(false);
  });
});
