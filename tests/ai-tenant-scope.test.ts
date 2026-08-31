import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("AI tenant scope contract", () => {
  test("threads the authenticated store through tools and every database-backed preview", () => {
    const actions = read("src/lib/ai/actions.ts");
    const toolCatalog = read("src/lib/ai/tool-catalog.ts");
    const toolLoop = read("src/lib/ai/tool-loop.ts");

    expect(toolLoop).toContain("storeId: input.storeId");
    expect(toolCatalog).toContain("storeId: string;");
    for (const signature of [
      "draftPurchaseOrderPreview(storeId: string",
      "inboundPreview(storeId: string",
      "pricePreview(storeId: string",
      "productCommandPreview(storeId: string",
      "customerPreview(storeId: string",
      "reportSummaryPreview(storeId: string",
      "orderActionPreview(storeId: string",
      "posCartPreview(storeId: string",
    ]) {
      expect(actions).toContain(signature);
    }
  });

  test("scopes AI entity reads and no longer slices an arbitrary first 300 products", () => {
    const actions = read("src/lib/ai/actions.ts");
    const candidates = read("src/lib/ai/entity-candidates.ts");
    const toolCatalog = read("src/lib/ai/tool-catalog.ts");

    for (const table of ["suppliers", "warehouses", "priceBooks", "productPrices", "categories", "brands", "customers", "orders"]) {
      expect(actions).toContain(`eq(${table}.storeId, storeId)`);
    }
    for (const table of ["products", "productSuppliers", "productUnits"]) {
      expect(candidates).toContain(`eq(${table}.storeId, storeId)`);
    }
    for (const table of ["products", "suppliers", "customers", "warehouses"]) {
      expect(toolCatalog).toContain(`eq(${table}.storeId, storeId)`);
    }
    expect(actions).not.toContain(".limit(300)");
    expect(actions).not.toContain(".limit(3000)");
  });

  test("keeps the AI restocking purchase mutation inside the authenticated store", () => {
    const route = read("src/app/api/mobile/ai/restocking/purchase-order/route.ts");
    const draft = read("src/lib/purchases/draft.ts");

    expect(route).toContain("createDraftPurchaseForUser(gate.storeId, gate.userId, body)");
    expect(draft).toContain("createDraftPurchaseForUser(\n  storeId: string,");
    expect(draft).toContain("defaultWarehouseId(storeId: string)");
    expect(draft).toContain("defaultSupplierId(storeId: string, productIds: string[])");
    for (const table of ["warehouses", "productSuppliers", "suppliers", "products"]) {
      expect(draft).toContain(`eq(${table}.storeId, storeId)`);
    }
    expect(draft).toMatch(/insert\(purchaseOrders\)[\s\S]*?values\(\{\s*storeId,/);
    expect(draft).toMatch(/insert\(purchaseOrderItems\)[\s\S]*?storeId,/);
  });

  test("routes new AI attachments through managed media and limits Supabase to legacy reads", () => {
    const attachments = read("src/app/api/mobile/ai/attachments/route.ts");
    const parser = read("src/lib/ai/attachments.ts");

    expect(attachments).toContain('purpose: "ai-attachment"');
    expect(attachments).toContain('form.get("sessionId")');
    expect(attachments).toContain(".putManagedObject");
    expect(attachments).toContain(".resolveMedia");
    expect(attachments).toContain("mediaId");
    expect(attachments).toContain("const ownerPrefix = `stores/${gate.storeId}/users/${gate.userId}/`");
    expect(attachments).toContain("path.startsWith(ownerPrefix)");
    expect(attachments).not.toContain("path.startsWith(`${gate.userId}/`)");
    expect(attachments).not.toContain(".upload(path, buffer");
    expect(parser).toContain("attachment.mediaId");
    expect(parser).toContain("readMedia");
    expect(parser).toContain("getAiAttachmentsBucket");
  });

  test("shows managed R2 as read-only while retaining the legacy bucket preference", () => {
    const settingsClient = read("src/app/(app)/settings/settings-client.tsx");
    const settingsSchema = read("src/lib/schemas/settings.ts");
    const settingsActions = read("src/lib/actions/settings.ts");

    expect(settingsClient).toContain("Cloudflare R2 (managed)");
    expect(settingsClient).not.toContain("AI_BUCKET_OPTIONS");
    expect(settingsClient).not.toContain('set("attachmentsBucket"');
    expect(settingsSchema).toContain("attachmentsBucket: z.enum(AI_ATTACHMENT_BUCKETS).optional()");
    expect(settingsActions).toContain("attachmentsBucket: v.attachmentsBucket ?? current.ai.attachmentsBucket");
  });

  test("binds every web attachment call site to one active or ephemeral AI session", () => {
    const api = read("src/components/ai-assistant/api.ts");
    const state = read("src/components/ai-assistant/use-assistant-state.ts");
    const quickAction = read("src/components/ai-quick-actions/ai-quick-action-modal.tsx");
    const types = read("src/components/ai-assistant/types.ts");

    expect(api).toContain('form.append("sessionId", sessionId)');
    expect(state).toContain("ensureUploadSession");
    expect(state).toContain("uploadAiAttachment(file, surface, uploadSessionId)");
    expect(quickAction).toContain("ensureUploadSession");
    expect(quickAction).toContain("uploadAiAttachment(file, surface, uploadSessionId)");
    expect(types).toContain("mediaId?: string;");
    expect(types).toContain("sessionId?: string;");
  });
});
