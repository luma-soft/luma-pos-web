import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { Textarea } from "@/components/ui/input";
import { Select, SelectOptionRow } from "@/components/ui/select";
import { MobilePrintPreviewFrame } from "@/app/(app)/tools/electrical-labels/electrical-labels-client";
import { SplitGuestRow } from "@/app/(app)/tables/[id]/split-guest-row";
import {
  eligibleTableMoveTargets,
  moveTableOrder,
} from "@/lib/tables/move-table-order";

const read = (path: string) => readFileSync(path, "utf8");

describe("mobile specialist layouts", () => {
  test("AI workspace and launcher reserve the mobile nav and safe area with 44px controls", () => {
    const page = read("src/app/(app)/ai/page.tsx");
    const launcher = read("src/components/ai-assistant-launcher.tsx");

    expect(page).toContain("h-[calc(100dvh-4rem-env(safe-area-inset-bottom))]");
    expect(page).toContain("[&_button]:min-h-11");
    expect(launcher).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(launcher).toContain("bottom-[calc(4.25rem+env(safe-area-inset-bottom))]");
    expect(launcher).toContain("[&_button]:min-h-11");
    expect(launcher).toContain("min-h-0 w-full flex-1");
  });

  test("tool pages use a native mobile header and stack editor/results below desktop", () => {
    const header = read("src/app/(app)/tools/tool-page-header.tsx");
    const tile = read("src/app/(app)/tools/tile-calculator.tsx");
    const electrical = read("src/app/(app)/tools/electrical-labels/electrical-labels-client.tsx");

    expect(header).toContain("<MobileTopBar");
    expect(header).toContain("hidden lg:block print:block");
    expect(tile).toContain("xl:grid-cols-[minmax(0,1fr)_22rem]");
    expect(tile).toContain("[&_button]:min-h-11");
    expect(electrical).toContain("xl:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.18fr)]");
    expect(electrical).toContain("[&_button]:min-h-11");
    expect(electrical).toContain("electrical-labels-print-root");
  });

  test("tool form controls and portaled option rows stay touch-safe", () => {
    const tile = read("src/app/(app)/tools/tile-calculator.tsx");
    const electrical = read("src/app/(app)/tools/electrical-labels/electrical-labels-client.tsx");

    expect(tile).toContain("h-11 lg:h-9");
    expect(tile).toContain('optionClassName="min-h-11 lg:min-h-0"');
    expect(electrical).toContain('optionClassName="min-h-11 lg:min-h-0"');
    expect(tile).toContain("sm:grid-cols-[minmax(0,1fr)_7rem_minmax(10rem,1fr)_44px]");
    expect(tile).toContain("lg:grid-cols-[minmax(0,1fr)_7rem_minmax(10rem,1fr)_2rem]");
    expect(tile).toContain("sm:grid-cols-[minmax(0,1fr)_7rem_7rem_44px]");
    expect(tile).toContain("lg:grid-cols-[minmax(0,1fr)_7rem_7rem_2rem]");
    expect(electrical).toContain("sm:grid-cols-[120px_minmax(0,1.35fr)_minmax(0,1fr)_84px_44px]");
    expect(electrical).toContain("lg:grid-cols-[44px_minmax(0,1.35fr)_minmax(0,1fr)_84px_32px]");

    const optionHtml = renderToStaticMarkup(createElement(SelectOptionRow, {
      active: true,
      wrapLabel: false,
      onSelect: () => undefined,
      className: "min-h-11 lg:min-h-0",
      label: "60 × 60 cm",
    }));
    expect(optionHtml).toContain("min-h-11");
    expect(optionHtml).toContain('role="option"');
    expect(optionHtml).toContain('aria-selected="true"');
  });

  test("tablet headers and quantity rows reserve their complete touch geometry", () => {
    const productCreate = read("src/app/(app)/inventory/tabs/product-create-menu.tsx");
    const orders = read("src/app/(app)/sales/tabs/orders.tsx");
    const quote = read("src/app/(app)/quotes/new/camera-quote-builder.tsx");
    const promotions = read("src/app/(app)/promotions/promo-widgets.tsx");
    const orderEditor = read("src/app/(app)/orders/[id]/edit/order-edit-form.tsx");

    expect(productCreate).toContain('<span className="hidden lg:inline">{label}</span>');
    expect(productCreate).toContain('"hidden h-4 w-4 transition-transform lg:block"');
    expect(orders).toContain("lg:flex-row lg:items-end lg:justify-between");
    expect(orders).not.toContain("sm:flex-row sm:items-end sm:justify-between");
    expect(quote).toContain("grid-cols-[minmax(0,1fr)_132px_44px]");
    expect(quote).toContain("lg:grid-cols-[minmax(0,1fr)_112px_32px]");
    expect(quote).toContain('className="w-[132px] lg:w-28"');
    expect(promotions).toContain("grid-cols-[auto_minmax(132px,1fr)_44px]");
    expect(promotions).toContain("sm:grid-cols-[auto_minmax(132px,132px)");
    expect(promotions).toContain("lg:grid-cols-[auto_minmax(72px,96px)");
    expect(orderEditor).toContain('className="ml-auto w-[132px] lg:w-28"');
  });

  test("product-create menu keeps its absolute panel anchored at tablet widths", () => {
    const productCreate = read("src/app/(app)/inventory/tabs/product-create-menu.tsx");

    expect(productCreate).toContain("sm:relative");
    expect(productCreate).not.toContain("sm:static");
    expect(productCreate).toContain("absolute bottom-full right-0");
    expect(productCreate).toContain("sm:top-full");
  });

  test("product-create menu gives its icon-only mobile trigger an accessible menu contract", () => {
    const productCreate = read("src/app/(app)/inventory/tabs/product-create-menu.tsx");

    expect(productCreate).toContain("aria-label={label}");
    expect(productCreate).toContain('aria-haspopup="menu"');
    expect(productCreate).toContain('role="menu"');
    expect(productCreate).toContain('role="menuitem"');
  });

  test("product editor modal is labelled and contains scroll chaining", () => {
    const products = read("src/app/(app)/inventory/tabs/products.tsx");
    const productForm = read("src/app/(app)/products/new/product-form.tsx");

    expect(products).toContain('role="dialog"');
    expect(products).toContain('aria-modal="true"');
    expect(products).toContain('aria-labelledby="product-editor-title"');
    expect(productForm).toContain('id={isModal ? "product-editor-title" : undefined}');
    expect(productForm).toContain('"flex-1 overflow-auto overscroll-contain');
  });

  test("product editor footer keeps the primary actions aligned on narrow screens", () => {
    const productForm = read("src/app/(app)/products/new/product-form.tsx");

    expect(productForm).toContain('align === "footer" && "grid grid-cols-1');
    expect(productForm).toContain('align === "footer" && "grid w-full grid-cols-2');
    expect(productForm).toContain('"order-1 w-full sm:order-none sm:w-auto"');
    expect(productForm).toContain('"order-3 col-span-2 w-full sm:order-none sm:w-auto"');
    expect(productForm).toContain('"order-2 w-full sm:order-none sm:w-auto"');
  });

  test("print toolbar reflows every action inside a narrow viewport", () => {
    const toolbar = read("src/components/print/print-toolbar.tsx");

    expect(toolbar).toContain("flex-wrap");
    expect(toolbar).toContain("lg:flex-nowrap");
    expect(toolbar).toContain("order-3 w-full");
    expect(toolbar).toContain("overflow-x-auto");
    expect(toolbar).toContain("w-full min-w-0");
    expect(toolbar).toContain("print:hidden");
  });

  test("print template selector puts containment geometry on its real flex item", () => {
    const toolbar = read("src/components/print/print-toolbar.tsx");
    expect(toolbar).toContain('rootClassName="order-4 w-full min-w-0');

    const html = renderToStaticMarkup(createElement(
      NextIntlClientProvider,
      {
        locale: "vi",
        messages: {},
        timeZone: "Asia/Ho_Chi_Minh",
        now: new Date("2026-07-29T00:00:00+07:00"),
      },
      createElement(Select, {
        value: "long",
        options: [{
          value: "long",
          label: "Mẫu hóa đơn tùy chỉnh có tên cực kỳ dài để kiểm tra tràn ngang",
        }],
        rootClassName: "order-4 w-full min-w-0",
        className: "min-w-0",
      }),
    ));

    expect(html).toContain("relative inline-block align-middle order-4 w-full min-w-0");
    expect(html).toContain("<button");
    expect(html).toContain("w-full");
    expect(html).toContain("min-w-0");
    expect(html).toContain('<span class="block truncate">');
    expect(html).toContain("Mẫu hóa đơn tùy chỉnh có tên cực kỳ dài");
  });

  test("shared textarea keeps auto-resize-compatible semantics with tablet-safe geometry", () => {
    const html = renderToStaticMarkup(createElement(
      NextIntlClientProvider,
      {
        locale: "vi",
        messages: {},
        timeZone: "Asia/Ho_Chi_Minh",
        now: new Date("2026-07-29T00:00:00+07:00"),
      },
      createElement(Textarea, {
        rows: 1,
        className: "resize-none overflow-y-auto",
        defaultValue: "Nội dung",
      }),
    ));

    expect(html).toContain("<textarea");
    expect(html).toContain('rows="1"');
    expect(html).toContain("min-h-11");
    expect(html).toContain("min-w-11");
    expect(html).toContain("lg:min-h-0");
    expect(html).toContain("lg:min-w-0");
    expect(html).toContain("resize-none");
    expect(html).toContain("overflow-y-auto");
  });

  test("electrical preview fits mobile while the print portal retains A4 output", () => {
    const electrical = read("src/app/(app)/tools/electrical-labels/electrical-labels-client.tsx");

    expect(electrical).toContain("<MobilePrintPreviewFrame");
    expect(electrical).toContain("overflow-hidden");
    expect(electrical).toContain("scale-[0.37]");
    expect(electrical).toContain("electrical-labels-print-root");
    expect(electrical).toContain("<PrintPage page={page}");

    const frameHtml = renderToStaticMarkup(createElement(
      MobilePrintPreviewFrame,
      null,
      createElement("div", null, "A4"),
    ));
    expect(frameHtml).toContain("w-full overflow-hidden");
    expect(frameHtml).toContain("scale-[0.37]");
  });

  test("F&B floor and dialogs keep controls touch-safe without narrow overflow", () => {
    const floor = read("src/app/(app)/tables/tables-floor.tsx");
    const modifiers = read("src/app/(app)/tables/modifiers-manage.tsx");
    const order = read("src/app/(app)/tables/[id]/table-order.tsx");
    const guestRow = read("src/app/(app)/tables/[id]/split-guest-row.tsx");

    expect(floor).toContain("grid-cols-1 min-[360px]:grid-cols-2");
    expect(floor).toContain("bottom-[calc(4.5rem+env(safe-area-inset-bottom))]");
    expect(floor.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(6);
    expect(modifiers.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(8);
    expect(order).toContain("touchTargets");
    expect(order.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(8);
    expect(modifiers).toContain("min-h-11 min-w-11");
    expect(order).toContain("min-h-11 min-w-11");
    expect(order).toContain("<SplitGuestRow");
    expect(guestRow).toContain("flex-col");
    expect(guestRow).toContain("break-words");

    const guestHtml = renderToStaticMarkup(createElement(SplitGuestRow, {
      label: "Guests",
      amount: "9,999,999,999 ₫/guest",
      quantityControl: createElement("button", { type: "button" }, "12"),
    }));
    expect(guestHtml).toContain("flex-col");
    expect(guestHtml).toContain("break-words");
    expect(guestHtml).toContain("9,999,999,999 ₫/guest");
  });

  test("table order exposes a touch-safe move workflow using eligible free targets", async () => {
    const page = read("src/app/(app)/tables/[id]/page.tsx");
    const order = read("src/app/(app)/tables/[id]/table-order.tsx");

    expect(page).toContain("eligibleTableMoveTargets");
    expect(page).toContain("moveTargets=");
    expect(order).toContain("moveTableOrder");
    expect(order).toContain("moveTableOrder(id, moveTargetId, moveTable)");
    expect(order).toContain("min-h-11");

    expect(eligibleTableMoveTargets("source", [
      { id: "source", name: "Source", zone: "A", status: "occupied" },
      { id: "free", name: "Free", zone: "A", status: "free" },
      { id: "busy", name: "Busy", zone: "B", status: "occupied" },
    ])).toEqual([
      { id: "free", name: "Free", zone: "A", status: "free" },
    ]);

    let payload: [string, string] | null = null;
    const result = await moveTableOrder("source", "free", async (sourceId, targetId) => {
      payload = [sourceId, targetId];
      return { ok: true, data: undefined };
    });
    expect(payload).toEqual(["source", "free"]);
    expect(result.ok).toBe(true);
  });

  test("KDS remains one column on mobile with reachable status actions", () => {
    const page = read("src/app/(app)/kds/page.tsx");
    const board = read("src/app/(app)/kds/kds-board.tsx");

    expect(page).toContain("overflow-x-hidden");
    expect(page).toContain("[&_button]:min-h-11");
    expect(board).toContain("grid grid-cols-1 sm:grid-cols-2");
    expect(board).toContain("setTicketItemStatus(itemId, status)");
    expect(board).toContain("serveTicket(ticketId)");
  });
});
