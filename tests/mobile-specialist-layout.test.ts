import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

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

  test("F&B floor and dialogs keep controls touch-safe without narrow overflow", () => {
    const floor = read("src/app/(app)/tables/tables-floor.tsx");
    const modifiers = read("src/app/(app)/tables/modifiers-manage.tsx");
    const order = read("src/app/(app)/tables/[id]/table-order.tsx");

    expect(floor).toContain("grid-cols-1 min-[360px]:grid-cols-2");
    expect(floor).toContain("bottom-[calc(4.5rem+env(safe-area-inset-bottom))]");
    expect(floor.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(6);
    expect(modifiers.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(8);
    expect(order).toContain("touchTargets");
    expect(order.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(8);
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
