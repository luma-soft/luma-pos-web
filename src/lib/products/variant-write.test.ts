import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import { createProductSchema, type CreateProductInput } from "@/app/(app)/products/new/schema";
import { buildVariantCombinations, variantCombinationBudget } from "./variant-model";
import { saveVariantGroupInTransaction } from "./variant-write";

const pg = new PGlite();
const database = drizzle(pg, { schema });
const store = randomUUID(), otherStore = randomUUID(), category = randomUUID(), otherCategory = randomUUID(), user = randomUUID();
const importedRoot = randomUUID(), importedChild = randomUUID();
let attributeId: string;
let beforeMigration: unknown;
const dialect = new PgDialect();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

// Use actual schema columns/types/defaults. Only unrelated foreign tables/indexes
// are omitted; the new migrations install their real tenant FKs and triggers.
async function createDomainTables() {
  await pg.exec("create role anon; create role authenticated; create table stores(id uuid primary key)");
  const enums = new Set<string>();
  for (const table of [schema.products, schema.categories, schema.brands, schema.suppliers, schema.warehouses,
    schema.profiles, schema.stockLevels, schema.stockMovements, schema.productUnits, schema.productSuppliers,
    schema.priceBooks, schema.productPrices, schema.inventoryCostBaselines, schema.inventoryCostAdjustments]) {
    const config = getTableConfig(table);
    for (const column of config.columns) if (column.enumValues?.length && !enums.has(column.getSQLType())) {
      await pg.exec(`create type ${column.getSQLType()} as enum (${column.enumValues.map(quote).join(",")})`);
      enums.add(column.getSQLType());
    }
    const definitions = config.columns.map((column) => {
      const value = column.default;
      const defaultSql = value === undefined ? "" : " default " + (value instanceof SQL ? dialect.sqlToQuery(value).sql
        : typeof value === "boolean" || typeof value === "number" ? String(value)
          : quote(typeof value === "string" ? value : JSON.stringify(value)));
      return `"${column.name}" ${column.getSQLType()}${column.notNull ? " not null" : ""}${defaultSql}${column.primary ? " primary key" : ""}`;
    });
    await pg.exec(`create table "${config.name}" (${definitions.join(",")})`);
  }
  await pg.exec("alter table products add unique(store_id,id); alter table products add unique(store_id,sku)");
  await pg.exec(await readFile(new URL("../../../supabase/denormalize-stock.sql", import.meta.url), "utf8"));
}

before(async () => {
  await createDomainTables();
  await pg.query("insert into stores values ($1),($2)", [store, otherStore]);
  await pg.query("insert into categories(id,store_id,name) values ($1,$2,'Network'),($3,$4,'Other')", [category, store, otherCategory, otherStore]);
  await pg.query("insert into profiles(id,store_id,full_name) values ($1,$2,'Tester')", [user, store]);
  await pg.query("insert into warehouses(store_id,name,is_default) values ($1,'Main',true)", [store]);
  await pg.query("insert into products(id,store_id,sku,name,category_id,specs,cost_price,retail_price) values ($1,$2,'IMPORTED-E','Imported E',$3,$4,1280000,1490000)", [importedRoot, store, category, JSON.stringify({ "Phiên bản": ["E"], __orderNote: ["Giữ ghi chú"] })]);
  await pg.query("insert into products(id,store_id,sku,name,category_id,related_product_id,specs,cost_price,retail_price) values ($1,$2,'IMPORTED-F','Imported F',$3,$4,$5,990000,1190000)", [importedChild, store, category, importedRoot, JSON.stringify({ "Phiên bản": ["F"] })]);
  await pg.query("insert into stock_levels(store_id,product_id,warehouse_id,quantity,min_level) select $1,$2,id,2,0 from warehouses where store_id=$1 and is_default", [store, importedChild]);
  for (const file of ["0122_product_attributes.sql", "0123_product_attribute_rename_sync.sql"]) await pg.exec(await readFile(new URL(`../../../drizzle/${file}`, import.meta.url), "utf8"));
  beforeMigration = (await pg.query("select row_to_json(p) as value from products p order by id")).rows;
  for (const file of ["0124_product_variant_contract.sql", "0125_product_variant_revision.sql"]) {
    await pg.exec(await readFile(new URL(`../../../drizzle/${file}`, import.meta.url), "utf8"));
  }
  attributeId = (await pg.query<{ id: string }>("select id from product_attributes where store_id=$1 and name='Phiên bản'", [store])).rows[0].id;
});
after(async () => { await pg.close(); });

function makeInput(overrides: Partial<CreateProductInput> = {}) {
  const attributes = [{ attributeId, name: "Phiên bản", values: ["E", "F"], valueIds: ["value-e", "value-f"], createsVariants: true }];
  const children = buildVariantCombinations(attributes).map((row, index) => ({ ...row, sku: `TEST-${randomUUID().slice(0,8)}-${row.variantName}`,
    costPrice: index === 0 ? 1280000 : 990000, retailPrice: index === 0 ? 1490000 : 1190000,
    initialStock: index === 0 ? 0 : 2, baseUnit: "cái", directSale: true }));
  return createProductSchema.parse({ name: "RAP2200", categoryId: category, sku: `GROUP-${randomUUID().slice(0,8)}`,
    attributes, variantChildren: children, variantContractVersion: 2, variantOperation: "create", requestId: randomUUID(), ...overrides });
}
async function save(input: ReturnType<typeof makeInput>, targetStore = store) {
  return database.transaction((tx) => saveVariantGroupInTransaction(tx as unknown as Parameters<typeof saveVariantGroupInTransaction>[0], targetStore, user, input));
}

test("variant metadata migrations preserve all imported product fields", async () => {
  assert.deepEqual((await pg.query("select row_to_json(p) as value from products p order by id")).rows, beforeMigration);
  assert.equal((await pg.query("select * from product_variant_groups")).rows.length, 1);
  assert.equal((await pg.query("select * from product_variant_members")).rows.length, 2);
  const ids = (await pg.query<{ product_id: string; combination_key: string | null }>("select product_id,combination_key from product_variant_members order by product_id")).rows;
  assert.deepEqual(ids.map((row) => row.product_id), [importedRoot, importedChild].sort());
  assert.ok(ids.every((row) => row.combination_key));
  assert.equal((await pg.query("select * from stock_movements")).rows.length, 0);
  assert.equal((await pg.query<{ stock: string }>("select sum(quantity)::text stock from stock_levels")).rows[0].stock, "2.0000");
});

test("creating E/F stores prices and 0/2 stock, then an identical retry creates nothing", async () => {
  const input = makeInput();
  const result = await save(input);
  assert.equal(result.createdIds.length, 3);
  const records = (await pg.query<{ variant_name: string; cost_price: string; retail_price: string; total_stock: string }>("select variant_name,cost_price,retail_price,total_stock from products where parent_product_id=$1 order by variant_name", [result.id])).rows;
  assert.deepEqual(records.map((row) => [row.variant_name, Number(row.cost_price), Number(row.retail_price), Number(row.total_stock)]), [["E",1280000,1490000,0],["F",990000,1190000,2]]);
  const before = (await pg.query("select (select count(*) from products) products,(select count(*) from stock_movements) movements")).rows;
  const retry = await save(input);
  assert.equal(retry.replayed, true);
  assert.equal(retry.id, result.id);
  assert.deepEqual((await pg.query("select (select count(*) from products) products,(select count(*) from stock_movements) movements")).rows, before);
  assert.equal((await pg.query<{ n: number }>("select count(*)::int n from stock_movements where product_id=any($1::uuid[])", [result.memberIds])).rows[0].n, 1);
});

test("renaming a value and editing prices preserves SKU IDs, unit IDs and stock history", async () => {
  const input = makeInput({ units: [{ unitName: "Hộp", multiplier: 2, barcode: "", priceOverride: null }] });
  const created = await save(input);
  const oldMembers = (await pg.query<{ id: string; variant_name: string; sku: string }>("select id,variant_name,sku from products where parent_product_id=$1 order by variant_name", [created.id])).rows;
  const oldUnits = (await pg.query("select id,product_id,unit_name,multiplier from product_units where product_id=any($1::uuid[]) order by id", [created.memberIds])).rows;
  const oldStock = (await pg.query("select product_id,warehouse_id,quantity from stock_levels where product_id=any($1::uuid[]) order by product_id,warehouse_id", [created.memberIds])).rows;
  const oldMovements = (await pg.query("select row_to_json(m) value from stock_movements m where product_id=any($1::uuid[]) order by id", [created.memberIds])).rows;
  await pg.query("update products set description='Thông số riêng của F' where id=$1", [oldMembers[1].id]);
  const revision = (await pg.query<{ revision: number }>("select revision from product_variant_groups where id=$1", [created.id])).rows[0].revision;
  const attributes = input.attributes.map((axis) => ({ ...axis, values: ["E mới", "F"] }));
  const combinations = buildVariantCombinations(attributes);
  const edit = makeInput({ ...input, requestId: randomUUID(), variantOperation: "edit", variantGroupId: created.id,
    variantRevision: revision, attributes, description: "Thông số chung mới", variantChildren: combinations.map((combo, index) => ({
      ...input.variantChildren[index], ...combo, productId: oldMembers[index].id, sku: oldMembers[index].sku,
      costPrice: input.variantChildren[index].costPrice + 10000, initialStock: 0,
    })) });
  await save(edit);
  assert.deepEqual((await pg.query<{ id: string }>("select id from products where parent_product_id=$1 order by id", [created.id])).rows.map((row) => row.id), oldMembers.map((row) => row.id).sort());
  assert.deepEqual((await pg.query("select id,product_id,unit_name,multiplier from product_units where product_id=any($1::uuid[]) order by id", [created.memberIds])).rows, oldUnits);
  assert.deepEqual((await pg.query("select product_id,warehouse_id,quantity from stock_levels where product_id=any($1::uuid[]) order by product_id,warehouse_id", [created.memberIds])).rows, oldStock);
  assert.deepEqual((await pg.query("select row_to_json(m) value from stock_movements m where product_id=any($1::uuid[]) order by id", [created.memberIds])).rows, oldMovements);
  assert.equal((await pg.query<{ description: string }>("select description from products where id=$1", [oldMembers[1].id])).rows[0].description, "Thông số riêng của F");
  assert.equal((await pg.query<{ cost_price: string }>("select cost_price from products where id=$1", [oldMembers[0].id])).rows[0].cost_price, "1290000.00");
});

test("a direct SKU price update invalidates a stale group editor without overwriting the price", async () => {
  const input = makeInput();
  const created = await save(input);
  const members = (await pg.query<{ id: string; variant_name: string; sku: string }>(
    "select id,variant_name,sku from products where parent_product_id=$1 order by variant_name",
    [created.id],
  )).rows;
  const revisionBefore = (await pg.query<{ revision: number }>(
    "select revision from product_variant_groups where id=$1",
    [created.id],
  )).rows[0].revision;
  const staleRequestId = randomUUID();
  const staleEdit = makeInput({
    ...input,
    requestId: staleRequestId,
    variantOperation: "edit",
    variantGroupId: created.id,
    variantRevision: revisionBefore,
    variantChildren: input.variantChildren.map((child, index) => ({
      ...child,
      productId: members[index].id,
      sku: members[index].sku,
      initialStock: 0,
    })),
  });

  await pg.query("update products set retail_price=777777 where id=$1", [members[0].id]);
  const revisionAfterDirectEdit = (await pg.query<{ revision: number }>(
    "select revision from product_variant_groups where id=$1",
    [created.id],
  )).rows[0].revision;
  assert.equal(revisionAfterDirectEdit, revisionBefore + 1);

  await assert.rejects(save(staleEdit), /products\.variants\.groupChanged/);
  assert.equal((await pg.query<{ retail_price: string }>(
    "select retail_price from products where id=$1",
    [members[0].id],
  )).rows[0].retail_price, "777777.00");
  assert.equal((await pg.query<{ revision: number }>(
    "select revision from product_variant_groups where id=$1",
    [created.id],
  )).rows[0].revision, revisionAfterDirectEdit);
  assert.equal((await pg.query(
    "select 1 from product_variant_requests where request_id=$1",
    [staleRequestId],
  )).rows.length, 0);
});

test("an existing draft SKU keeps explicit null tier prices and lifecycle through a group edit", async () => {
  const input = makeInput({ wholesalePrice: 800000, contractorPrice: 900000, agentPrice: 1000000 });
  const created = await save(input);
  const members = (await pg.query<{ id: string; sku: string }>(
    "select id,sku from products where parent_product_id=$1 order by variant_name", [created.id],
  )).rows;
  await pg.query("update products set is_active=false,lifecycle_status='draft',wholesale_price=null,contractor_price=null,agent_price=null where id=$1", [members[0].id]);
  const revision = (await pg.query<{ revision: number }>("select revision from product_variant_groups where id=$1", [created.id])).rows[0].revision;
  const edit = makeInput({ ...input, requestId: randomUUID(), variantOperation: "edit", variantGroupId: created.id,
    variantRevision: revision, variantChildren: input.variantChildren.map((child, index) => ({
      ...child, productId: members[index].id, sku: members[index].sku, initialStock: 0,
      ...(index === 0 ? { directSale: false, wholesalePrice: null, contractorPrice: null, agentPrice: null } : {}),
    })) });
  await save(edit);
  assert.deepEqual((await pg.query(
    "select is_active,lifecycle_status,wholesale_price,contractor_price,agent_price from products where id=$1", [members[0].id],
  )).rows[0], { is_active: false, lifecycle_status: "draft", wholesale_price: null, contractor_price: null, agent_price: null });
});

test("cross-store writes and duplicate combinations are rejected without partial writes", async () => {
  const input = makeInput();
  const snapshot = (await pg.query("select count(*)::int n from products")).rows;
  await assert.rejects(save(input, otherStore));
  await assert.rejects(save({ ...input, variantChildren: [input.variantChildren[0], input.variantChildren[0]] }), /invalidCombination/);
  assert.deepEqual((await pg.query("select count(*)::int n from products")).rows, snapshot);
  assert.equal((await pg.query("select * from product_variant_requests where request_id=$1", [input.requestId])).rows.length, 0);
});

test("partial add rejects removing an axis value still used by retained SKUs", async () => {
  const input = makeInput();
  const created = await save(input);
  const attributes = input.attributes.map((axis) => ({ ...axis, values: ["E", "G"], valueIds: ["value-e", "value-g"] }));
  const g = buildVariantCombinations(attributes)[1];
  const change = makeInput({ attributes, variantOperation: "add", variantGroupId: created.id, variantRevision: created.revision,
    variantChildren: [{ ...input.variantChildren[0], ...g, sku: `ADDED-${randomUUID().slice(0,8)}`, initialStock: 0 }] });
  await assert.rejects(save(change), /invalidCombination|keepExisting/);
  assert.equal((await pg.query("select * from products where parent_product_id=$1", [created.id])).rows.length, 2);
});

test("adopting a real existing SKU keeps it as the group root and counts its stock once", async () => {
  const rootId = randomUUID();
  await pg.query("insert into products(id,store_id,sku,name,category_id,cost_price,retail_price) values ($1,$2,$3,'Existing real SKU',$4,1280000,1490000)", [rootId, store, `REAL-${rootId.slice(0,8)}`, category]);
  await pg.query("insert into stock_levels(store_id,product_id,warehouse_id,quantity,min_level) select $1,$2,id,3,0 from warehouses where store_id=$1 and is_default", [store, rootId]);
  const input = makeInput();
  input.variantGroupId = rootId;
  input.variantOperation = "add";
  input.variantRevision = 0;
  input.variantChildren[0] = { ...input.variantChildren[0], productId: rootId, sku: `REAL-${rootId.slice(0,8)}`, initialStock: 0 };
  const saved = await save(input);
  assert.equal(saved.id, rootId);
  const records = (await pg.query<{ id: string; is_variant_parent: boolean; total_stock: string; related_product_id: string | null }>("select id,is_variant_parent,total_stock,related_product_id from products where id=$1 or related_product_id=$1 order by id", [rootId])).rows;
  assert.equal(records.length, 2);
  assert.ok(records.every((row) => !row.is_variant_parent));
  assert.equal(records.filter((row) => row.id === rootId).length, 1);
  assert.equal(records.reduce((sum, row) => sum + Number(row.total_stock), 0), 5);
  assert.equal((await pg.query("select * from product_variant_members where group_id=$1", [rootId])).rows.length, 2);
});

test("236 imported members survive no-op edit; only persisted data grants the 200-addition budget", async () => {
  const rootId = randomUUID();
  const axes = [{ attributeId, name: "Phiên bản", createsVariants: true,
    values: Array.from({ length: 236 }, (_, i) => `Legacy ${i}`),
    valueIds: Array.from({ length: 236 }, (_, i) => `legacy-value-${i}`) }];
  const combinations = buildVariantCombinations(axes, { maxCombinations: variantCombinationBudget(236) });
  const members = combinations.map((combo, i) => ({ ...combo, id: i === 0 ? rootId : randomUUID(),
    sku: `LARGE-${rootId.slice(0, 8)}-${i}`, costPrice: 1000 + i, retailPrice: 2000 + i }));
  await database.insert(schema.products).values(members.map((member) => ({ id: member.id, storeId: store,
    sku: member.sku, name: `Large - ${member.variantName}`, variantName: member.variantName,
    categoryId: category, baseUnit: "cái", costPrice: String(member.costPrice), retailPrice: String(member.retailPrice),
    relatedProductId: member.id === rootId ? null : rootId, specs: member.specs,
  })));
  await pg.query("insert into product_variant_groups(store_id,id,kind,attributes) values($1,$2,'related',$3::jsonb)", [store, rootId, JSON.stringify(axes)]);
  await pg.query(`insert into product_variant_members(store_id,group_id,product_id,combination_key,option_value_ids)
    select $1,$2,x.id::uuid,x.key,x.ids from jsonb_to_recordset($3::jsonb) as x(id text,key text,ids jsonb)`,
  [store, rootId, JSON.stringify(members.map((member) => ({ id: member.id, key: member.combinationKey, ids: member.optionValueIds })))]);
  await pg.query("insert into stock_levels(store_id,product_id,warehouse_id,quantity,min_level) select $1,$2,id,3,0 from warehouses where store_id=$1 and is_default", [store, rootId]);
  const beforeMembers = (await pg.query("select id,sku,name,variant_name,cost_price,retail_price,base_unit,specs from products where id=$1 or related_product_id=$1 order by id", [rootId])).rows;
  const beforeStock = (await pg.query("select row_to_json(s) value from stock_levels s where product_id=$1", [rootId])).rows;
  const revision = (await pg.query<{ revision: number }>("select revision from product_variant_groups where id=$1", [rootId])).rows[0].revision;
  const payload = makeInput({ name: `Large - ${members[0].variantName}`, variantGroupId: rootId, variantOperation: "edit",
    variantRevision: revision, attributes: axes, variantChildren: members.map((member) => ({ ...member,
      productId: member.id, initialStock: 0, baseUnit: "cái", directSale: true,
    })) });
  const edited = await save(payload);
  assert.deepEqual(edited.createdIds, []);
  assert.equal(edited.memberIds.length, 236);
  assert.deepEqual((await pg.query("select id,sku,name,variant_name,cost_price,retail_price,base_unit,specs from products where id=$1 or related_product_id=$1 order by id", [rootId])).rows, beforeMembers);
  assert.deepEqual((await pg.query("select row_to_json(s) value from stock_levels s where product_id=$1", [rootId])).rows, beforeStock);

  const expandedAxes = [{ ...axes[0], values: [...axes[0].values, ...Array.from({ length: 201 }, (_, i) => `New ${i}`)],
    valueIds: [...axes[0].valueIds, ...Array.from({ length: 201 }, (_, i) => `new-value-${i}`)] }];
  const tooLarge = buildVariantCombinations(expandedAxes, { maxCombinations: 437 });
  const spoofed = makeInput({ ...payload, requestId: randomUUID(), variantRevision: edited.revision,
    attributes: expandedAxes, variantChildren: tooLarge.map((combo, i) => ({ ...combo,
      productId: members[i]?.id ?? randomUUID(), sku: members[i]?.sku ?? `SPOOF-${rootId}-${i}`,
      costPrice: 1000, retailPrice: 2000, initialStock: 0, baseUnit: "cái", directSale: true,
    })) });
  await assert.rejects(save(spoofed), /products\.variants\.tooMany/);
  assert.equal((await pg.query<{ n: number }>("select count(*)::int n from products where id=$1 or related_product_id=$1", [rootId])).rows[0].n, 236);

  const allowedAxes = [{ ...expandedAxes[0], values: expandedAxes[0].values.slice(0, 436), valueIds: expandedAxes[0].valueIds.slice(0, 436) }];
  const allowedCombinations = buildVariantCombinations(allowedAxes, { maxCombinations: variantCombinationBudget(236) });
  const add = makeInput({ ...payload, requestId: randomUUID(), variantOperation: "add", variantRevision: edited.revision,
    attributes: allowedAxes, variantChildren: allowedCombinations.map((combo, i) => ({
      ...combo, ...(members[i] ? { productId: members[i].id } : {}),
      sku: members[i]?.sku ?? `NEW-${rootId}-${i}`, costPrice: members[i]?.costPrice ?? 5000,
      retailPrice: members[i]?.retailPrice ?? 6000, initialStock: 0, baseUnit: "cái", directSale: true,
    })) });
  const added = await save(add);
  assert.equal(added.createdIds.length, 200);
  assert.equal(added.memberIds.length, 436);
  assert.deepEqual((await pg.query("select row_to_json(s) value from stock_levels s where product_id=$1", [rootId])).rows, beforeStock);
});
