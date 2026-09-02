import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  installedAssets,
  products,
  projects,
  serviceJobMaterials,
  serviceJobs,
  stockLevels,
  warehouses,
} = schema;
const { saveServiceInstallationBatchCore } = await import(
  `${projectRoot}/src/lib/services/installation-items.ts`
);

const client = new PGlite();
const db = drizzle(client, { schema });
const STORE_ID = "00000000-0000-4000-8000-000000000001";
await client.exec("create role anon; create role authenticated;");
for (const file of readdirSync(`${projectRoot}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${projectRoot}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

const [warehouse] = await db.insert(warehouses).values({ name: "Kho chính", isDefault: true }).returning();
const [camera] = await db.insert(products).values({
  sku: "CAM-001",
  name: "Camera IP",
  baseUnit: "cái",
  costPrice: "500000",
  retailPrice: "800000",
}).returning();
const [cable] = await db.insert(products).values({
  sku: "CAB-001",
  name: "Dây mạng CAT6",
  baseUnit: "m",
  costPrice: "5000",
  retailPrice: "8000",
}).returning();
await db.insert(stockLevels).values([
  { productId: camera.id, warehouseId: warehouse.id, quantity: "10" },
  { productId: cable.id, warehouseId: warehouse.id, quantity: "20" },
]);
const [project] = await db.insert(projects).values({ name: "Camera kho", serviceType: "camera" }).returning();
const [job] = await db.insert(serviceJobs).values({
  projectId: project.id,
  code: "DV-INSTALL-1",
  serviceType: "camera",
  title: "Thi công camera",
}).returning();

const cameraBatch = {
  storeId: STORE_ID,
  createdBy: null,
  projectId: project.id,
  jobId: job.id,
  requestId: "install-batch-1",
  stockMode: "plan",
  invoiceMode: "none",
  items: [{
    clientDraftId: "camera",
    productId: camera.id,
    unitName: "cái",
    quantity: 2,
    tracking: "asset",
    serialNumbers: ["CAM-A", "CAM-B"],
    assetKind: "camera",
  }],
};
const result = await db.transaction((tx) => saveServiceInstallationBatchCore(tx, cameraBatch));
await db.transaction((tx) => saveServiceInstallationBatchCore(tx, cameraBatch));
let payloadConflict = false;
try {
  await db.transaction((tx) => saveServiceInstallationBatchCore(tx, {
    ...cameraBatch,
    items: [{ ...cameraBatch.items[0], quantity: 3 }],
  }));
} catch (error) {
  payloadConflict = error instanceof Error && error.message === "SERVICE_MUTATION_PAYLOAD_CONFLICT";
}
if (!payloadConflict) throw new Error("reused request id accepted a different installation payload");
if (result.assetCount !== 2) throw new Error(`expected 2 assets, got ${result.assetCount}`);
const cameraMaterials = await db.select().from(serviceJobMaterials).where(and(
  eq(serviceJobMaterials.jobId, job.id),
  eq(serviceJobMaterials.productId, camera.id),
));
if (cameraMaterials.length !== 1 || Number(cameraMaterials[0].usedQuantity) !== 2) {
  throw new Error("tracked product did not create one material usage row");
}
const assets = await db.select().from(installedAssets).where(eq(installedAssets.projectId, project.id));
if (assets.length !== 2 || assets.map((asset) => asset.serialNumber).sort().join(",") !== "CAM-A,CAM-B") {
  throw new Error("tracked product did not create serialised installed assets");
}

const cableBatch = {
  storeId: STORE_ID,
  createdBy: null,
  projectId: project.id,
  jobId: job.id,
  requestId: "install-batch-2",
  stockMode: "issue",
  warehouseId: warehouse.id,
  invoiceMode: "none",
  items: [{
    clientDraftId: "cable",
    productId: cable.id,
    unitName: "m",
    quantity: 5,
    tracking: "consumable",
    serialNumbers: [],
  }],
};
await db.transaction((tx) => saveServiceInstallationBatchCore(tx, cableBatch));
await db.transaction((tx) => saveServiceInstallationBatchCore(tx, cableBatch));
const [cableLevel] = await db.select().from(stockLevels).where(and(
  eq(stockLevels.productId, cable.id),
  eq(stockLevels.warehouseId, warehouse.id),
));
if (Number(cableLevel.quantity) !== 15) {
  throw new Error(`expected cable stock 15 after issue and retry, got ${cableLevel.quantity}`);
}
const [cableMaterial] = await db.select().from(serviceJobMaterials).where(and(
  eq(serviceJobMaterials.jobId, job.id),
  eq(serviceJobMaterials.productId, cable.id),
));
if (Number(cableMaterial.usedQuantity) !== 5) {
  throw new Error(`expected cable usage 5 after retry, got ${cableMaterial.usedQuantity}`);
}

console.log("service installation items: unified material, assets, serials, and stock passed");
await client.close();
