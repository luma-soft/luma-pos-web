import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { TouchTargetToggle } from "@/components/mobile-ui";

const settingsSource = readFileSync("src/app/(app)/settings/settings-client.tsx", "utf8");
const printSource = readFileSync("src/app/(app)/settings/print/print-settings-form.tsx", "utf8");
const labelSource = readFileSync("src/app/(app)/settings/labels/label-settings-form.tsx", "utf8");

describe("mobile settings shell", () => {
  test("uses one mobile top bar with a 44px section picker and safe content spacing", () => {
    expect(settingsSource).toMatch(
      /<MobileTopBar[\s\S]*?title=\{L \? sec\.vi : sec\.en\}[\s\S]*?bottom=\{[\s\S]*?<Select[\s\S]*?aria-label=\{L \? "Chọn mục cài đặt" : "Choose settings section"\}[\s\S]*?min-h-11/,
    );
    expect(settingsSource).toContain(
      "px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+3rem)] md:px-7 md:py-6",
    );
    expect(settingsSource).toMatch(/className="hidden md:block"[\s\S]*?breadcrumb\.settings/);
    expect(settingsSource).toMatch(/const FI = "min-h-11/);
    expect(settingsSource).toMatch(/const btnS = "inline-flex min-h-11 min-w-11/);
    expect(settingsSource).toContain('const searchableTouch = "[&>button]:h-11 lg:[&>button]:h-10"');
    expect(settingsSource.match(/<TouchTargetToggle/g)?.length).toBeGreaterThanOrEqual(6);
  });

  test("keeps toggle semantics while expanding the mobile hit target", () => {
    const html = renderToStaticMarkup(
      <TouchTargetToggle checked aria-label="Thông báo" onChange={() => undefined} />,
    );

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="Thông báo"');
    expect(html).toMatch(/class="[^"]*h-11[^"]*w-11[^"]*lg:h-\[21px\][^"]*lg:w-\[38px\]/);
  });
});

describe("mobile settings template editors", () => {
  test.each([
    ["print", printSource],
    ["label", labelSource],
  ])("%s editor stacks editor before preview and exposes safe sticky actions", (_name, source) => {
    expect(source).toContain("grid grid-cols-1");
    expect(source).toMatch(/className="order-1 space-y-4"[\s\S]*?className="order-2/);
    expect(source).toContain("sticky bottom-0");
    expect(source).toContain("md:static");
    expect(source).toContain("pb-[calc(env(safe-area-inset-bottom)+0.75rem)]");
    expect(source).toMatch(/aria-label=\{t\("common\.save"\)\}[\s\S]*?min-h-11/);
    expect(source).toMatch(/aria-label=\{t\("(?:print|label)Settings\.duplicate"\)\}[\s\S]*?min-h-11/);
    expect(source).toMatch(/aria-label=\{t\("(?:print|label)Settings\.setDefault"\)\}[\s\S]*?min-h-11/);
    expect(source).toMatch(/aria-label=\{t\("(?:print|label)Settings\.deactivate"\)\}[\s\S]*?min-h-11/);
  });

  test.each([
    ["print", printSource],
    ["label", labelSource],
  ])("%s header flushes against the same responsive page padding", (_name, source) => {
    expect(source).toContain(
      'className="px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+3rem)] md:p-6"',
    );
    expect(source).toMatch(
      /<MobileDetailHeader[\s\S]*?flush[\s\S]*?className="-mx-3 -mt-3 mb-5 md:-mx-6 md:-mt-6"/,
    );
    expect(source).not.toMatch(/<MobileDetailHeader[\s\S]*?className="-mx-4/);
  });
});
