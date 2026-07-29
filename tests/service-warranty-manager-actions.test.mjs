import { readFileSync, readdirSync } from "node:fs";
import { mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  installedAssets,
  profiles,
  projects,
  serviceAttachments,
  serviceJobs,
} = schema;
const client = new PGlite();
const db = drizzle(client, { schema });
await client.exec("create role anon; create role authenticated;");
for (const file of readdirSync(`${projectRoot}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${projectRoot}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

const managerId = "11111111-1111-4111-8111-111111111111";
let codeSequence = 0;
mock.module("@/db", () => ({ db, schema }));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
mock.module("@/lib/actions/common", () => ({
  generateCode: () => `BH-MANAGER-${++codeSequence}`,
  getProfileId: async (id) => id,
  isUniqueViolation: () => false,
  pgErrorCode: () => null,
  requireManager: async () => ({ ok: true, userId: managerId, role: "manager" }),
  requireStockAccess: async () => ({ ok: false, error: "errors.forbidden" }),
  toMoney: (value) => String(value ?? 0),
  toQty: (value) => String(value ?? 0),
}));
const {
  createWarrantyClaim,
  updateWarrantyClaim,
} = await import(`${projectRoot}/src/lib/actions/services.ts`);

await db.insert(profiles).values({
  id: managerId,
  fullName: "Manager",
  role: "manager",
});
const [project] = await db.insert(projects).values({
  name: "Manager warranty project",
  serviceType: "camera",
  serviceStage: "warranty",
}).returning();
const [jobA, jobB] = await db.insert(serviceJobs).values([
  {
    projectId: project.id,
    code: "MGR-JOB-A",
    serviceType: "camera",
    title: "Job A",
    status: "warranty",
  },
  {
    projectId: project.id,
    code: "MGR-JOB-B",
    serviceType: "camera",
    title: "Job B",
    status: "warranty",
  },
]).returning();
const [assetA, assetB] = await db.insert(installedAssets).values([
  {
    projectId: project.id,
    jobId: jobA.id,
    assetKind: "camera",
    name: "Asset A",
  },
  {
    projectId: project.id,
    jobId: jobB.id,
    assetKind: "camera",
    name: "Asset B",
  },
]).returning();

const unlinked = await createWarrantyClaim({
  projectId: project.id,
  title: "Legacy unlinked claim",
  priority: "normal",
});
if (!unlinked.ok) throw new Error(`manager null/null create failed: ${unlinked.error}`);
const unlinkedUpdate = await updateWarrantyClaim({
  claimId: unlinked.data.id,
  title: "Legacy unlinked claim updated",
  priority: "normal",
  laborCharge: 0,
  materialCharge: 0,
});
if (!unlinkedUpdate.ok) throw new Error(`manager null/null update failed: ${unlinkedUpdate.error}`);

const linked = await createWarrantyClaim({
  projectId: project.id,
  jobId: jobA.id,
  assetId: assetA.id,
  title: "Linked manager claim",
  priority: "high",
});
if (!linked.ok) throw new Error(`manager linked create failed: ${linked.error}`);
const crossJob = await createWarrantyClaim({
  projectId: project.id,
  jobId: jobA.id,
  assetId: assetB.id,
  title: "Same-project cross-job claim",
  priority: "normal",
});
if (crossJob.ok || crossJob.error !== "services.errors.relationMismatch") {
  throw new Error("manager action accepted a same-project cross-job asset");
}

await db.insert(serviceAttachments).values({
  projectId: project.id,
  jobId: jobA.id,
  claimId: linked.data.id,
  assetId: assetA.id,
  category: "issue",
  bucket: "service-evidence",
  path: `${linked.data.id}/manager-evidence.png`,
  fileName: "manager-evidence.png",
  mimeType: "image/png",
  sizeBytes: 128,
  sha256: "a".repeat(64),
  createdBy: managerId,
});
const originalConsoleError = console.error;
console.error = () => undefined;
const immutable = await updateWarrantyClaim({
  claimId: linked.data.id,
  jobId: jobB.id,
  assetId: assetB.id,
  title: "Attempt scope change",
  priority: "high",
  laborCharge: 0,
  materialCharge: 0,
});
console.error = originalConsoleError;
if (immutable.ok || immutable.error !== "services.errors.warrantyScopeImmutable") {
  throw new Error(`manager action did not map immutable evidence scope: ${immutable.ok ? "ok" : immutable.error}`);
}

console.log("manager warranty actions: null/null compatibility, exact job scope, and immutable evidence verified");
