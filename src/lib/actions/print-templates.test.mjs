import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";

const pg = new PGlite();
const database = drizzle(pg, { schema });
const storeId = randomUUID();
const otherStoreId = randomUUID();
const userId = randomUUID();
const activities = [];

mock.module("@/db", () => ({ db: database }));
mock.module("@/lib/actions/common", () => ({
  requireManager: async () => ({ ok: true, storeId, userId, role: "owner" }),
}));
mock.module("@/lib/sync/revalidate-app-data", () => ({ revalidateAppData() {} }));
mock.module("@/lib/audit/activity-log", () => ({ recordActivity: async (_tx, event) => activities.push(event) }));

const { deletePrintTemplate } = await import("./print-templates");

beforeAll(async () => {
  await pg.exec(`
    create type print_doc_type as enum ('order', 'quote', 'booking', 'purchase', 'return', 'receipt');
    create type paper_size as enum ('a4', 'a5', 'k80');
    create table print_templates (
      id uuid primary key,
      store_id uuid not null,
      name text not null,
      doc_type print_doc_type not null,
      paper_default paper_size not null default 'a5',
      is_default boolean not null default false,
      is_active boolean not null default true,
      sort_order integer not null default 0,
      store_name text not null default '',
      store_address text not null default '',
      store_phone text not null default '',
      store_tax_code text not null default '',
      footer_note text not null default '',
      options jsonb not null default '{}',
      updated_at timestamptz not null default now()
    );
    create unique index print_templates_default_idx on print_templates(store_id, doc_type)
      where is_default = true and is_active = true;
  `);
});

beforeEach(async () => {
  activities.length = 0;
  await pg.exec("truncate print_templates");
});

afterAll(async () => { await pg.close(); });

async function addTemplate({
  store = storeId,
  name,
  isDefault = false,
  isActive = true,
  sortOrder = 0,
} = {}) {
  const [template] = await database.insert(schema.printTemplates).values({
    id: randomUUID(),
    storeId: store,
    name: name ?? "Mẫu in",
    docType: "order",
    paperDefault: "a4",
    isDefault,
    isActive,
    sortOrder,
  }).returning();
  return template;
}

test("refuses to delete the default template and keeps it in the list", async () => {
  const template = await addTemplate({ isDefault: true });
  const result = await deletePrintTemplate(template.id);

  expect(result).toEqual({ ok: false, error: "printSettings.errors.cannotDeleteDefault" });
  expect(await database.select({ id: schema.printTemplates.id }).from(schema.printTemplates)).toEqual([{ id: template.id }]);
});

test("deletes a non-default template and returns the existing default for selection", async () => {
  const defaultTemplate = await addTemplate({ name: "Mặc định", isDefault: true });
  const toDelete = await addTemplate({ name: "Bản thử" });
  const unrelated = await addTemplate({ store: otherStoreId, name: "Cửa hàng khác" });

  const result = await deletePrintTemplate(toDelete.id);

  expect(result).toEqual({ ok: true, data: { defaultId: defaultTemplate.id } });
  const remainingIds = await database.select({ id: schema.printTemplates.id }).from(schema.printTemplates);
  expect(remainingIds.map((row) => row.id).sort()).toEqual([defaultTemplate.id, unrelated.id].sort());
  expect(activities.some((event) => event.action === "print.template.deleted" && event.entityId === toDelete.id)).toBe(true);
});

test("promotes an available template when the document type has no active default", async () => {
  const toDelete = await addTemplate({ name: "Bản thử", sortOrder: 0 });
  const replacement = await addTemplate({ name: "Bản còn lại", sortOrder: 1 });

  const result = await deletePrintTemplate(toDelete.id);

  expect(result).toEqual({ ok: true, data: { defaultId: replacement.id } });
  const [savedReplacement] = await database.select({ isDefault: schema.printTemplates.isDefault, isActive: schema.printTemplates.isActive })
    .from(schema.printTemplates).where(eq(schema.printTemplates.id, replacement.id));
  expect(savedReplacement).toEqual({ isDefault: true, isActive: true });
});

test("does not delete a template from another store", async () => {
  const template = await addTemplate({ store: otherStoreId, name: "Cửa hàng khác" });

  expect(await deletePrintTemplate(template.id)).toEqual({ ok: false, error: "errors.notFound" });
  expect(await database.select({ id: schema.printTemplates.id }).from(schema.printTemplates)).toEqual([{ id: template.id }]);
});
