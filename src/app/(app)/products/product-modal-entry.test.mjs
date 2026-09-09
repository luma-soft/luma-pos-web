import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const detailPage = readFileSync(new URL("./[id]/page.tsx", import.meta.url), "utf8");
const editPage = readFileSync(new URL("./[id]/edit/page.tsx", import.meta.url), "utf8");
const newPage = readFileSync(new URL("./new/page.tsx", import.meta.url), "utf8");
const routes = readFileSync(new URL("../../../lib/routes.ts", import.meta.url), "utf8");
const aiActions = readFileSync(new URL("../../../lib/ai/actions.ts", import.meta.url), "utf8");
const productForm = readFileSync(new URL("./new/product-form.tsx", import.meta.url), "utf8");
const productsModal = readFileSync(new URL("../inventory/tabs/products.tsx", import.meta.url), "utf8");
const productsTable = readFileSync(new URL("../inventory/tabs/products-table.tsx", import.meta.url), "utf8");
const interceptedDetailPage = readFileSync(new URL("../@productModal/(.)products/[id]/page.tsx", import.meta.url), "utf8");
const productDetailDialog = readFileSync(new URL("../../../components/product-detail-dialog.tsx", import.meta.url), "utf8");

test("hard-loaded product detail keeps the detail inside a dialog", () => {
  expect(detailPage).toContain("<ProductDetailDialog");
  expect(detailPage).not.toContain('surface="page"');
  expect(existsSync(new URL("../@productModal/products/[id]/page.tsx", import.meta.url))).toBe(false);
});

test("product detail and editor occupy one modal surface", () => {
  for (const page of [detailPage, interceptedDetailPage]) {
    const editorBranch = page.indexOf('if (query.edit === "1")');
    expect(editorBranch).toBeGreaterThan(-1);
    expect(editorBranch).toBeLessThan(page.indexOf("<ProductDetailDialog"));
    expect(page.match(/<ProductEditorModal/g)?.length).toBe(1);
  }
  expect(productsModal).toContain("<ProductModalFrame");
  expect(productDetailDialog).toContain("<ProductModalFrame");
  expect(productsModal).not.toContain('className="fixed inset-0 z-[100]');
});

test("editing from detail adds a history entry and cancel returns to detail", () => {
  const editActionStart = productsTable.indexOf('label={t("products.actions.edit")}');
  const editAction = productsTable.slice(
    editActionStart,
    productsTable.indexOf('tone="primary"', editActionStart),
  );
  expect(editAction).toContain('?edit=1`');
  expect(editAction).not.toContain("replace=");
  expect(interceptedDetailPage).toContain('cancelNavigation="back"');
  expect(interceptedDetailPage).toContain('closeNavigation="replace"');
  expect(detailPage).toContain("closeHrefOverride={productEditorCloseHref(id)}");
});

test("legacy product edit and create pages redirect into inventory modals", () => {
  expect(editPage).toContain("redirect(");
  expect(editPage).toContain('productModal: "edit"');
  expect(newPage).toContain("redirect(");
  expect(newPage).toContain('productModal: "create"');
});

test("internal product form links target modal URLs without a legacy page hop", () => {
  expect(routes).not.toContain('ProductNew: "/products/new"');
  expect(routes).not.toContain('productEdit: (id: string) => `/products/${id}/edit`');
  expect(aiActions).not.toContain('href: "/products/new?source=ai-preview"');
  expect(aiActions).not.toContain('`/products/${productId}/edit?source=ai-preview`');
});

test("product save refreshes only when the editor stays open", () => {
  const saveValues = productForm.slice(
    productForm.indexOf("async function saveValues"),
    productForm.indexOf("function resetForNextProduct"),
  );
  const refreshCount = saveValues.match(/router\.refresh\(\)/g)?.length ?? 0;
  const stayOpenRefreshCount = saveValues.match(
    /resetForNextProduct\(\);\s*router\.refresh\(\)/g,
  )?.length ?? 0;

  expect(refreshCount).toBe(stayOpenRefreshCount);
});

test("save and create another continues from the product that was just created", () => {
  expect(productForm).toContain("sameTypeHref(result.data.createdProductId ?? result.data.id)");
  expect(productForm).toContain("groupAdding ? variantTemplateName ?? form.watch(\"name\")");
  expect(productsModal).toContain('key={`${modal}-${templateProduct?.id ?? "blank"}`}');
  expect(productsModal).toContain('variantTemplateName={seedMode === "groupAdd" ? templateProduct?.name : undefined}');
  const variantSave = productForm.slice(
    productForm.indexOf("if (values.variantGroupId || values.variantChildren.length > 0)"),
    productForm.indexOf("if (isEdit && productId)"),
  );
  expect(variantSave).not.toMatch(/resetForNextProduct\(\);\s*router\.refresh\(\)/);
});
