import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  products,
  productUnits,
  projects,
  serviceJobMaterials,
  serviceJobs,
  stockLevels,
  stockMovements,
  warehouses,
} = schema;
const { releaseServiceJobMaterialReservationsCore, reserveServiceJobMaterialStockCore, syncServiceJobMaterialStockCore } = await import(
  `${projectRoot}/src/lib/services/material-stock.ts`
);

const client = new PGlite();
const db = drizzle(client, { schema });

for (const file of readdirSync(`${projectRoot}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${projectRoot}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

const [warehouse] = await db.insert(warehouses).values({ name: "Kho chính", isDefault: true }).returning();
const [product] = await db.insert(products).values({
  sku: "DAY-CAMERA",
  name: "Dây camera",
  baseUnit: "m",
  costPrice: "5000",
  retailPrice: "8000",
}).returning();
await db.insert(productUnits).values({ productId: product.id, unitName: "cuộn", multiplier: "4" });
await db.insert(stockLevels).values({ productId: product.id, warehouseId: warehouse.id, quantity: "20" });
const [project] = await db.insert(projects).values({ name: "Camera kho", serviceType: "camera" }).returning();
const [job] = await db.insert(serviceJobs).values({
  projectId: project.id,
  code: "DV-STOCK-1",
  serviceType: "camera",
  title: "Kéo dây",
}).returning();
const [material] = await db.insert(serviceJobMaterials).values({
  jobId: job.id,
  productId: product.id,
  unitName: "cuộn",
  plannedQuantity: "3",
  usedQuantity: "3",
}).returning();

await db.transaction((tx) => syncServiceJobMaterialStockCore(tx, {
  materialId: material.id,
  warehouseId: warehouse.id,
  createdBy: null,
}));
let [level] = await db.select().from(stockLevels).where(eq(stockLevels.productId, product.id));
if (Number(level.quantity) !== 8) throw new Error(`expected stock 8 after issue, got ${level.quantity}`);

await db.update(serviceJobMaterials).set({ usedQuantity: "1" }).where(eq(serviceJobMaterials.id, material.id));
await db.transaction((tx) => syncServiceJobMaterialStockCore(tx, {
  materialId: material.id,
  warehouseId: warehouse.id,
  createdBy: null,
}));
[level] = await db.select().from(stockLevels).where(eq(stockLevels.productId, product.id));
if (Number(level.quantity) !== 16) throw new Error(`expected stock 16 after return, got ${level.quantity}`);

const before = await db.select().from(stockMovements).where(eq(stockMovements.refId, material.id));
await db.transaction((tx) => syncServiceJobMaterialStockCore(tx, {
  materialId: material.id,
  warehouseId: warehouse.id,
  createdBy: null,
}));
const after = await db.select().from(stockMovements).where(eq(stockMovements.refId, material.id));
if (after.length !== before.length) throw new Error("idempotent sync created another movement");

await db.update(serviceJobMaterials).set({ usedQuantity: "10" }).where(eq(serviceJobMaterials.id, material.id));
let insufficientStockError = "";
try {
  await db.transaction((tx) => syncServiceJobMaterialStockCore(tx, {
    materialId: material.id,
    warehouseId: warehouse.id,
    createdBy: null,
  }));
} catch (error) {
  insufficientStockError = error instanceof Error ? error.message : "";
}
if (insufficientStockError !== "INSUFFICIENT_SERVICE_MATERIAL_STOCK") {
  throw new Error(`expected insufficient stock error, got ${insufficientStockError || "none"}`);
}
[level] = await db.select().from(stockLevels).where(eq(stockLevels.productId, product.id));
if (Number(level.quantity) !== 16) throw new Error(`failed sync changed stock to ${level.quantity}`);

const [reservationJob] = await db.insert(serviceJobs).values({
  projectId: project.id,
  code: "DV-STOCK-2",
  serviceType: "camera",
  title: "Dự phòng vật tư",
}).returning();
const [reservedMaterial] = await db.insert(serviceJobMaterials).values({
  jobId: reservationJob.id,
  productId: product.id,
  unitName: "cuộn",
  plannedQuantity: "3",
  usedQuantity: "0",
}).returning();
await db.transaction((tx) => reserveServiceJobMaterialStockCore(tx, {
  materialId: reservedMaterial.id,
  warehouseId: warehouse.id,
  quantity: 2,
  createdBy: null,
}));
[level] = await db.select().from(stockLevels).where(eq(stockLevels.productId, product.id));
if (Number(level.quantity) !== 16 || Number(level.reserved) !== 8) throw new Error("reservation did not hold stock");
await db.update(serviceJobMaterials).set({ usedQuantity: "1" }).where(eq(serviceJobMaterials.id, reservedMaterial.id));
await db.transaction((tx) => syncServiceJobMaterialStockCore(tx, {
  materialId: reservedMaterial.id,
  warehouseId: warehouse.id,
  createdBy: null,
}));
[level] = await db.select().from(stockLevels).where(eq(stockLevels.productId, product.id));
if (Number(level.quantity) !== 12 || Number(level.reserved) !== 4) throw new Error("issued stock did not consume its reservation");
await db.transaction((tx) => releaseServiceJobMaterialReservationsCore(tx, { materialId: reservedMaterial.id }));
[level] = await db.select().from(stockLevels).where(eq(stockLevels.productId, product.id));
if (Number(level.reserved) !== 0) throw new Error("released reservation still held stock");

console.log("service material stock: issue, return, idempotent sync, and rollback passed");
