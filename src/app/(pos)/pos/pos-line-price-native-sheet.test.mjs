import { readSource } from "../../../test-support/read-source.mjs";
import { test, expect } from "bun:test";
const src = readSource("./pos-client.tsx", import.meta.url);
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
test("a product priced 0 opens editable, not as a free line", async () => {
 expect(editor).toContain("if (!line.freeRestore) return { ...createLinePriceEditorState(editablePrice, editableDiscount, editableDiscountMode, editableDiscountValue), free: false };");
 expect(editor).toContain("priceBooks) ?? Number.NaN, 0), free: false };");
 const { createLinePriceEditorState, setLinePriceInput, resolveLinePriceEditor } = await import("@/lib/pos/line-price-editor");
 const opened = { ...createLinePriceEditorState(0, 0), free: false };
 const typed = setLinePriceInput(opened, "150000");
 expect(typed.free).toBe(false);
 expect(resolveLinePriceEditor(typed).unitPrice).toBe(150000);
});
