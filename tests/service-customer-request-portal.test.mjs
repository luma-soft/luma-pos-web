import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const portal = await import(`${projectRoot}/src/lib/services/customer-request-portal.ts`);
const token = await import(`${projectRoot}/src/lib/services/customer-request-token.ts`);
const {
  profiles,
  projects,
  serviceCustomerRequests,
  serviceCustomerRequestAttachments,
  servicePublicRateLimits,
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

if (!serviceCustomerRequestAttachments || !servicePublicRateLimits) {
  throw new Error("portal evidence and durable rate limit schema exports are required");
}

const managerId = "11111111-1111-4111-8111-111111111111";
const inactiveManagerId = "22222222-2222-4222-8222-222222222222";
await db.insert(profiles).values([
  { id: managerId, fullName: "Active manager", role: "manager" },
  { id: inactiveManagerId, fullName: "Inactive manager", role: "manager", isActive: false },
]);
const [project] = await db.insert(projects).values({ name: "Customer site", serviceType: "camera" }).returning();
const rawToken = token.createCustomerRequestToken();
const [request] = await db.insert(serviceCustomerRequests).values({
  code: "YC-PORTAL-1",
  projectId: project.id,
  title: "Support request",
  contactName: "Customer",
  tokenHash: token.hashCustomerRequestToken(rawToken),
  tokenExpiresAt: new Date("2026-08-01T00:00:00.000Z"),
}).returning();

const first = await db.transaction((tx) => portal.submitCustomerRequestCore(tx, {
  requestId: request.id,
  title: "Camera offline",
  description: "Camera at front gate is offline",
  contactName: "Customer",
  contactPhone: "0900000000",
  priority: "high",
  now: new Date("2026-07-29T00:00:00.000Z"),
  responseMinutes: 60,
  resolutionMinutes: 240,
}));
if (first.status !== "new" || first.notificationUserIds.join(",") !== managerId) {
  throw new Error("submission must remain new and target active managers only");
}
let replayRejected = false;
try {
  await db.transaction((tx) => portal.submitCustomerRequestCore(tx, {
    requestId: request.id,
    title: "Replay",
    description: "Replay",
    contactName: "Customer",
    contactPhone: "0900000000",
    priority: "high",
    now: new Date("2026-07-29T00:01:00.000Z"),
    responseMinutes: 60,
    resolutionMinutes: 240,
  }));
} catch (error) {
  replayRejected = error instanceof Error && error.message === "CUSTOMER_REQUEST_NOT_SUBMITTABLE";
}
if (!replayRejected) throw new Error("submitted token replay was accepted");

const [expiredRequest] = await db.insert(serviceCustomerRequests).values({
  code: "YC-PORTAL-EXPIRED",
  projectId: project.id,
  title: "Expired request",
  contactName: "Customer",
  tokenHash: "b".repeat(64),
  tokenExpiresAt: new Date("2026-07-28T00:00:00.000Z"),
}).returning();
let expiredRejected = false;
try {
  await db.transaction((tx) => portal.submitCustomerRequestCore(tx, {
    requestId: expiredRequest.id,
    title: "Expired",
    description: "Expired token submission",
    contactName: "Customer",
    contactPhone: "0900000000",
    priority: "normal",
    now: new Date("2026-07-29T00:00:00.000Z"),
    responseMinutes: null,
    resolutionMinutes: null,
  }));
} catch (error) {
  expiredRejected = error instanceof Error && error.message === "CUSTOMER_REQUEST_NOT_SUBMITTABLE";
}
if (!expiredRejected) throw new Error("expired token submission was accepted");

const [foreignProject] = await db.insert(projects).values({ name: "Foreign site", serviceType: "camera" }).returning();
const [foreignJob] = await db.insert(serviceJobs).values({
  projectId: foreignProject.id,
  code: "CV-FOREIGN",
  serviceType: "camera",
  title: "Foreign job",
}).returning();
let crossProjectRejected = false;
try {
  await db.transaction((tx) => portal.manageCustomerRequestCore(tx, {
    requestId: request.id,
    actorId: managerId,
    status: "triaged",
    linkedJobId: foreignJob.id,
    now: new Date("2026-07-29T00:05:00.000Z"),
  }));
} catch (error) {
  crossProjectRejected = error instanceof Error && error.message === "CUSTOMER_REQUEST_JOB_MISMATCH";
}
if (!crossProjectRejected) throw new Error("cross-project job link was accepted");

const rateIdentity = "portal:get:token-hash:198.51.100.10";
for (let count = 0; count < 3; count++) {
  const result = await db.transaction((tx) => portal.consumePublicRateLimitCore(tx, {
    key: rateIdentity,
    limit: 3,
    windowSeconds: 60,
    now: new Date("2026-07-29T00:00:10.000Z"),
  }));
  if (!result.allowed) throw new Error("rate limit rejected before limit");
}
const limited = await db.transaction((tx) => portal.consumePublicRateLimitCore(tx, {
  key: rateIdentity,
  limit: 3,
  windowSeconds: 60,
  now: new Date("2026-07-29T00:00:10.000Z"),
}));
if (limited.allowed || limited.retryAfterSeconds < 1) throw new Error("durable rate limit did not reject excess request");

await db.insert(serviceCustomerRequestAttachments).values({
  requestId: request.id,
  bucket: "service-customer-request-evidence",
  path: `${request.id}/private.jpg`,
  fileName: "camera.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 10,
  sha256: "a".repeat(64),
});
const [attachment] = await db.select().from(serviceCustomerRequestAttachments)
  .where(eq(serviceCustomerRequestAttachments.requestId, request.id));
if (!attachment || attachment.sha256 !== "a".repeat(64)) {
  throw new Error("durable evidence metadata was not stored");
}

const acl = await client.query(`
  select c.relname, c.relrowsecurity,
    has_table_privilege('anon', c.oid, 'select') as anon_select,
    has_table_privilege('authenticated', c.oid, 'select') as authenticated_select
  from pg_class c
  where c.relname in ('service_customer_request_attachments', 'service_public_rate_limits')
`);
if (acl.rows.length !== 2 || acl.rows.some((row) => !row.relrowsecurity || row.anon_select || row.authenticated_select)) {
  throw new Error("portal security tables must have RLS and no direct client read grants");
}

console.log("customer request portal: one-time submit, manager notifications, durable rate limits, private evidence, and ACL verified");
