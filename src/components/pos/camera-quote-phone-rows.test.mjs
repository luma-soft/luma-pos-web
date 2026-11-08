import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const s=readFileSync(new URL("./camera-quote-panel.tsx",import.meta.url),"utf8");
test("camera quote material controls fit narrow screens and retain desktop row",()=>{
 expect(s).toContain("grid-cols-[minmax(0,1fr)_44px]");
 expect(s).toContain("lg:grid-cols-[minmax(0,1fr)_120px_32px]");
 expect(s).toContain('rootClassName="col-span-2 min-w-0 w-full lg:col-span-1"');
 expect(s).toContain('className="w-full min-w-0"');
 expect(s).toContain("h-11 w-11 min-h-11 min-w-11");
});
test("camera and material business editing still uses original callbacks",()=>{
 expect(s).toContain("updatePackage(pkg.key, { quantity:");
 expect(s).toContain("updateMaterial(pkg, materialIndex, productId)");
 expect(s).toContain("cameraQuotePrice(id, price, cameraQuoteSettings)");
 expect(s).toContain("onChange(packages.filter((item)");
});
