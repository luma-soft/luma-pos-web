import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { brands, categories, products, productSuppliers, productUnits, stockLevels, stockMovements, suppliers, warehouses, profiles, priceBooks, productPrices } from "@/db/schema";
import type { CreateProductOutput } from "@/app/(app)/products/new/schema";
import { buildVariantCombinations, MAX_VARIANT_COMBINATIONS, normalizeVariantAttributes, validateVariantSubmission, variantCombinationBudget, VariantValidationError, variantNameKey, type NormalizedVariantAttribute } from "./variant-model";

type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];
export type SavedVariantGroup = { id: string; replayed: boolean; createdIds: string[]; memberIds: string[]; revision: number };
type StoredGroup = { id: string; kind: "native" | "related"; attributes: NormalizedVariantAttribute[]; excluded_combination_keys: string[]; revision: number; requires_review: boolean };
const fail = (code: string): never => { throw new VariantValidationError(code); };
const json = (value: unknown) => JSON.stringify(value);
const numberText = (value: number | null | undefined) => value == null ? null : String(value);

/** One transaction owns metadata, SKUs, opening stock and the retry receipt. */
export async function saveVariantGroupInTransaction(tx: Tx, storeId: string, userId: string, v: CreateProductOutput): Promise<SavedVariantGroup> {
  const requestId = v.requestId ?? randomUUID();
  const payloadHash = createHash("sha256").update(json(v)).digest("hex");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${storeId + ":variants:" + requestId}, 0))`);
  const previousRequest = await tx.execute<{ group_id: string; payload_hash: string }>(sql`
    select group_id, payload_hash from product_variant_requests where store_id=${storeId}::uuid and request_id=${requestId}::uuid
  `);
  if (previousRequest.rows.length) {
    const previous = previousRequest.rows[0];
    if (previous.payload_hash !== payloadHash) fail("products.variants.requestConflict");
    return { id: previous.group_id, replayed: true, createdIds: [], memberIds: [], revision: 0 };
  }

  // Foreign keys alone do not enforce tenant ownership for these older tables.
  if (!(await tx.select({ id: categories.id }).from(categories).where(and(eq(categories.storeId, storeId), eq(categories.id, v.categoryId))).limit(1)).length) fail("errors.invalidData");
  if (v.brandId && !(await tx.select({ id: brands.id }).from(brands).where(and(eq(brands.storeId, storeId), eq(brands.id, v.brandId))).limit(1)).length) fail("errors.invalidData");
  const supplierIds = [...new Set(v.supplierIds)];
  if (supplierIds.length && (await tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.storeId, storeId), inArray(suppliers.id, supplierIds)))).length !== supplierIds.length) fail("errors.invalidData");

  const groupId = v.variantGroupId ?? randomUUID();
  let kind: "native" | "related" = v.variantChildren.length === 1 ? "related" : "native";
  let revision = 0;
  let stored: StoredGroup | undefined;
  let existing: typeof products.$inferSelect[] = [];
  let existingRootSku: string | undefined;
  if (v.variantGroupId) {
    const [root] = await tx.select().from(products).where(and(eq(products.storeId, storeId), eq(products.id, groupId))).for("update");
    if (!root || root.parentProductId || root.relatedProductId || root.productKind !== "product") fail("products.variants.invalidGroup");
    existingRootSku = root.sku;
    kind = root.isVariantParent ? "native" : "related";
    const result = await tx.execute<StoredGroup>(sql`select * from product_variant_groups where store_id=${storeId}::uuid and id=${groupId}::uuid for update`);
    stored = result.rows[0];
    revision = stored?.revision ?? 0;
    if (v.variantRevision !== revision) fail("products.variants.groupChanged");
    existing = await tx.select().from(products).where(and(eq(products.storeId, storeId), kind === "native"
      ? eq(products.parentProductId, groupId) : or(eq(products.id, groupId), eq(products.relatedProductId, groupId)))).for("update");
  } else if (v.variantOperation !== "create" || v.variantChildren.some((child) => child.productId)) fail("products.variants.invalidGroup");
  // The server budget is derived only from persisted membership and exclusions.
  // Client-provided product IDs or draft exclusions cannot increase this limit.
  const maxCombinations = v.variantGroupId
    ? variantCombinationBudget(existing.length, stored?.excluded_combination_keys.length ?? 0)
    : MAX_VARIANT_COMBINATIONS;
  let axes = normalizeVariantAttributes(v.variantContractVersion === 2 ? v.attributes : v.attributes.map((a) => ({ ...a, createsVariants: true })));
  const originalRows = validateVariantSubmission({ attributes: axes, children: v.variantChildren, excludedCombinationKeys: v.excludedCombinationKeys, allowPartial: v.variantOperation === "add", maxCombinations });
  if (!axes.length || !originalRows.length) fail("products.variants.emptyGroup");
  if (originalRows.filter((row) => !row.productId).length > MAX_VARIANT_COMBINATIONS) fail("products.variants.tooMany");
  const catalog = await tx.execute<{ id: string; name: string; name_key: string }>(sql`
    select a.id,a.name,n.name_key from product_attributes a join product_attribute_aliases n
    on n.store_id=a.store_id and n.attribute_id=a.id where a.store_id=${storeId}::uuid
  `);
  const originalAxes = axes;
  axes = axes.map((axis) => {
    const attribute = catalog.rows.find((a) => a.id === axis.attributeId) ?? catalog.rows.find((a) => a.name_key === variantNameKey(axis.name));
    if (!attribute) return fail("products.attributes.notFound");
    if (v.variantContractVersion === 2 && axis.attributeId !== attribute.id) return fail("products.variants.invalidAttributes");
    return { ...axis, attributeId: attribute.id, name: attribute.name };
  });
  const canonicalCombos = buildVariantCombinations(axes, { maxCombinations });
  const originalCombos = buildVariantCombinations(originalAxes, { maxCombinations });
  const originalToCanonical = new Map(originalCombos.map((combo, index) => [combo.combinationKey, canonicalCombos[index]]));
  const children = originalRows.map((row) => ({ ...row, ...originalToCanonical.get(row.combinationKey)! }));
  const barcodes = children.map((row) => row.barcode?.trim()).filter((value): value is string => Boolean(value));
  if (new Set(barcodes).size !== barcodes.length) fail("products.variants.barcodeExists");
  if (barcodes.length) {
    const existingCodes = await tx.select({ id: products.id, barcode: products.barcode }).from(products)
      .where(and(eq(products.storeId, storeId), inArray(products.barcode, barcodes)));
    if (existingCodes.some((row) => !children.some((child) => child.productId === row.id && child.barcode?.trim() === row.barcode))) fail("products.variants.barcodeExists");
    const unitCodes = await tx.select({ productId: productUnits.productId }).from(productUnits)
      .where(and(eq(productUnits.storeId, storeId), inArray(productUnits.barcode, barcodes)));
    if (unitCodes.length) fail("products.variants.barcodeExists");
  }
  const exclusions = v.excludedCombinationKeys.map((key) => originalToCanonical.get(key)?.combinationKey ?? key);
  const identities = await tx.execute<{ product_id: string; combination_key: string | null }>(sql`
    select product_id, combination_key from product_variant_members where store_id=${storeId}::uuid and group_id=${groupId}::uuid
  `);
  const identityByProduct = new Map(identities.rows.map((row) => [row.product_id, row.combination_key]));
  const existingById = new Map(existing.map((row) => [row.id, row]));
  const submittedIds = new Set(children.flatMap((row) => row.productId ? [row.productId] : []));
  if (children.some((child) => child.productId && !existingById.has(child.productId))) fail("products.variants.invalidGroup");
  if (v.variantOperation !== "add" && existing.some((row) => !submittedIds.has(row.id))) fail("products.variants.keepExisting");
  if (!stored && existing.some((row) => !submittedIds.has(row.id))) fail("products.variants.assignExisting");
  // Do not silently remap an existing SKU when an axis/value disappears.
  for (const child of children) {
    if (!child.productId) continue;
    const oldKey = identityByProduct.get(child.productId);
    if (oldKey && oldKey !== child.combinationKey) fail("products.variants.keepIdentity");
  }
  const submittedKeys = new Set(children.map((child) => child.combinationKey));
  const retainedKeys = existing.filter((row) => !submittedIds.has(row.id)).map((row) => identityByProduct.get(row.id));
  const validKeys = new Set(canonicalCombos.map((row) => row.combinationKey));
  if (retainedKeys.some((key) => !key || submittedKeys.has(key) || !validKeys.has(key))) fail("products.variants.invalidCombination");
  if (exclusions.some((key) => retainedKeys.includes(key))) fail("products.variants.keepExisting");
  const covered = new Set([...submittedKeys, ...retainedKeys, ...exclusions]);
  if (canonicalCombos.some((combo) => !covered.has(combo.combinationKey))) fail("products.variants.missingCombinations");

  const weight = v.weight == null ? null : String(v.weightUnit === "g" ? v.weight / 1000 : v.weight);
  const physical = { weight, location: v.location?.trim() || null,
    dimensions: [v.width, v.length, v.thickness].some((n) => n != null) ? `${[v.width, v.length, v.thickness].filter((n) => n != null).join(" × ")} ${v.dimUnit}` : null };
  const rootSku = existingRootSku || v.sku?.trim() || `SP${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const common = {
    storeId, productKind: "product" as const, categoryId: v.categoryId, brandId: v.brandId || null, supplierId: supplierIds[0] || null,
    baseUnit: v.baseUnit || "cái", description: v.description || null, imageUrls: v.imageUrls,
    costPrice: String(v.costPrice), retailPrice: String(v.retailPrice), wholesalePrice: numberText(v.wholesalePrice),
    contractorPrice: numberText(v.contractorPrice), agentPrice: numberText(v.agentPrice), vatRate: numberText(v.vatRate),
    priceByWeight: v.priceByWeight, trackBatches: v.trackBatches, shelfLifeDays: v.shelfLifeDays ?? null,
    specs: v.invoiceNote?.trim() ? { __orderNote: [v.invoiceNote.trim()] } : null,
    m2PerUnit: v.width && v.length ? String(v.width * v.length * (v.dimUnit === "mm" ? 0.000001 : v.dimUnit === "cm" ? 0.0001 : 1)) : null,
    ...physical,
  };
  const createdIds: string[] = [];
  const commonEdit = { name: v.name.trim(), description: v.description || null, categoryId: v.categoryId,
    brandId: v.brandId || null, supplierId: supplierIds[0] || null, imageUrls: v.imageUrls };
  if (!v.variantGroupId && kind === "native") {
    await tx.insert(products).values({ ...common, id: groupId, sku: rootSku, name: v.name.trim(), isVariantParent: true, isActive: false, lifecycleStatus: v.lifecycleStatus });
    createdIds.push(groupId);
  }
  if (v.variantGroupId && kind === "native" && v.variantOperation === "edit") {
    // Shared description is stored on the parent; child overrides stay untouched.
    await tx.update(products).set({ ...commonEdit, updatedAt: sql`now()` }).where(and(eq(products.storeId, storeId), eq(products.id, groupId)));
  }
  const [warehouse] = await tx.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.storeId, storeId), eq(warehouses.isDefault, true))).limit(1);
  const [profile] = await tx.select({ id: profiles.id }).from(profiles).where(and(eq(profiles.storeId, storeId), eq(profiles.id, userId))).limit(1);
  if (!warehouse && children.some((c) => !c.productId && c.initialStock > 0)) fail("products.errors.stockWarehouseMissing");
  const nextMembers: { id: string; combinationKey: string; optionValueIds: string[] }[] = [];
  for (const child of children) {
    const current = child.productId ? existingById.get(child.productId) : undefined;
    const id = current?.id ?? (!v.variantGroupId && kind === "related" ? groupId : randomUUID());
    const sku = child.sku?.trim() || current?.sku || (kind === "related" && !v.variantGroupId ? rootSku : `${rootSku}-${randomUUID().slice(0, 6).toUpperCase()}`);
    const specs = { ...(current ? Object.fromEntries(Object.entries(current.specs ?? {}).filter(([key]) => key.startsWith("__"))) : common.specs), ...child.specs };
    const optionalPrice = (key: "wholesalePrice" | "contractorPrice" | "agentPrice") =>
      child[key] !== undefined ? numberText(child[key]) : current ? current[key] : numberText(v[key]);
    const commercial = { sku, barcode: child.barcode?.trim() || null, variantName: child.variantName,
      costPrice: String(child.costPrice), retailPrice: String(child.retailPrice), wholesalePrice: optionalPrice("wholesalePrice"),
      contractorPrice: optionalPrice("contractorPrice"), agentPrice: optionalPrice("agentPrice"),
      specs, isActive: child.directSale,
      lifecycleStatus: current && current.isActive === child.directSale ? current.lifecycleStatus : child.directSale ? "active" : "archived" };
    if (current) {
      if (child.baseUnit !== current.baseUnit) fail("products.variants.keepUnit");
      const name = current.variantName && current.name.endsWith(` - ${current.variantName}`)
        ? `${current.name.slice(0, -(` - ${current.variantName}`).length)} - ${child.variantName}` : current.name;
      await tx.update(products).set({ ...(id === groupId && v.variantOperation === "edit" ? commonEdit : {}), ...commercial,
        name: id === groupId && v.variantOperation === "edit" ? v.name.trim() : name,
        updatedAt: sql`now()` }).where(and(eq(products.storeId, storeId), eq(products.id, id)));
    } else {
      await tx.insert(products).values({ ...common, ...commercial, id,
        name: `${v.name.trim()} - ${child.variantName}`, baseUnit: child.baseUnit || v.baseUnit,
        parentProductId: kind === "native" ? groupId : null,
        relatedProductId: kind === "related" && id !== groupId ? groupId : null,
        // Native children inherit common description dynamically; separate overrides can be edited later.
        description: kind === "native" ? null : common.description,
        imageUrls: child.imageUrls.length ? child.imageUrls : v.imageUrls,
      });
      createdIds.push(id);
      if (warehouse) {
        await tx.insert(stockLevels).values({ storeId, productId: id, warehouseId: warehouse.id,
          quantity: String(child.initialStock), minLevel: String(child.minLevel) });
        if (child.initialStock > 0) await tx.insert(stockMovements).values({ storeId, productId: id, warehouseId: warehouse.id,
          type: "init", quantity: String(child.initialStock), unitCost: String(child.costPrice), refType: "product_init", refId: id,
          note: "Tồn đầu khi tạo biến thể", createdBy: profile?.id ?? null });
      }
    }
    nextMembers.push({ id, combinationKey: child.combinationKey, optionValueIds: child.optionValueIds });
  }
  // Group-level supplier edits apply to the root; existing child overrides stay untouched.
  if (v.variantGroupId && v.variantOperation === "edit") {
    await tx.delete(productSuppliers).where(and(eq(productSuppliers.storeId, storeId), eq(productSuppliers.productId, groupId)));
    if (supplierIds.length) await tx.insert(productSuppliers).values(supplierIds.map((supplierId, index) => ({ storeId, productId: groupId, supplierId, isPrimary: index === 0 })));
  }
  // Existing unit IDs are never recreated.
  if (children.filter((child) => !child.productId).length > 1 && v.units.some((unit) => unit.barcode?.trim())) {
    fail("products.variants.unitBarcodePerSku");
  }
  for (const id of createdIds) {
    if (v.units.length) await tx.insert(productUnits).values(v.units.map((unit, index) => ({ storeId, productId: id,
      unitName: unit.unitName.trim(), multiplier: String(unit.multiplier), barcode: id === groupId && kind === "native" ? null : unit.barcode?.trim() || null,
      priceOverride: numberText(unit.priceOverride), sortOrder: index })));
    if (supplierIds.length) await tx.insert(productSuppliers).values(supplierIds.map((supplierId, index) => ({ storeId, productId: id, supplierId, isPrimary: index === 0 })));
  }
  const bookIds = Object.keys(v.priceBookPrices);
  if (bookIds.length) {
    const allowedBooks = await tx.select({ id: priceBooks.id }).from(priceBooks).where(and(eq(priceBooks.storeId, storeId), inArray(priceBooks.id, bookIds)));
    if (allowedBooks.length !== bookIds.length) fail("errors.invalidData");
    for (const id of createdIds) for (const bookId of bookIds) {
      const price = v.priceBookPrices[bookId];
      if (price != null) await tx.insert(productPrices).values({ storeId, productId: id, priceBookId: bookId, price: String(price) });
    }
  }
  revision++;
  await tx.execute(sql`insert into product_variant_groups(store_id,id,kind,attributes,excluded_combination_keys,requires_review,revision)
    values(${storeId}::uuid,${groupId}::uuid,${kind},${json(axes)}::jsonb,${json(exclusions)}::jsonb,false,${revision})
    on conflict(store_id,id) do update set attributes=excluded.attributes, excluded_combination_keys=excluded.excluded_combination_keys,
      requires_review=false, revision=excluded.revision`);
  for (const member of nextMembers) await tx.execute(sql`insert into product_variant_members(store_id,group_id,product_id,combination_key,option_value_ids)
    values(${storeId}::uuid,${groupId}::uuid,${member.id}::uuid,${member.combinationKey},${json(member.optionValueIds)}::jsonb)
    on conflict(store_id,product_id) do update set combination_key=excluded.combination_key, option_value_ids=excluded.option_value_ids`);
  await tx.execute(sql`delete from product_variant_group_attributes where store_id=${storeId}::uuid and group_id=${groupId}::uuid`);
  for (const axis of axes) await tx.execute(sql`insert into product_variant_group_attributes(store_id,group_id,attribute_id)
    values(${storeId}::uuid,${groupId}::uuid,${axis.attributeId}::uuid)`);
  await tx.execute(sql`insert into product_variant_requests(store_id,request_id,payload_hash,group_id)
    values(${storeId}::uuid,${requestId}::uuid,${payloadHash},${groupId}::uuid)`);
  return { id: groupId, replayed: false, createdIds, memberIds: [...new Set([...existing.map((row) => row.id), ...nextMembers.map((row) => row.id)])], revision };
}
