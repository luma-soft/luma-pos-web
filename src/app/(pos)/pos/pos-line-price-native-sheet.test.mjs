import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./pos-client.tsx",import.meta.url),"utf8");
const editor = src.slice(src.indexOf("function LinePriceEditor("));
test("POS price editor is a bottom sheet on phones while retaining desktop placement",()=>{
 expect(editor).toContain("fixed inset-x-0 bottom-0");
 expect(editor).toContain("env(safe-area-inset-bottom)");
 expect(editor).toContain("lg:left-1/2 lg:top-1/2 lg:w-100");
 expect(editor).toContain("lg:rounded-xl lg:p-4");
 expect(editor).toContain('t("common.done")');
 expect(editor).toContain('onClick={onClose}');
});
test("editing remains wired to original price logic and mobile focus is deferred",()=>{
 expect(editor).toContain('window.matchMedia("(min-width: 1024px)")');
 expect(editor).not.toContain("value={editor.price} autoFocus");
 expect(editor).toContain('ref={priceInputRef}');
 expect(editor).toContain("onChange={setPrice}");
 expect(editor).toContain("onValueChange={setDiscount}");
 expect(editor).toContain("onCheckedChange={changeFree}");
 expect(editor).toContain("onChangeRef.current(selectedPriceBook()");
});
