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
  serviceCustomerRequestStorageCleanup,
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

const [sameProjectJob] = await db.insert(serviceJobs).values({
  projectId: project.id,
  code: "CV-SAME",
  serviceType: "camera",
  title: "Same project job",
}).returning();
await db.transaction((tx) => portal.manageCustomerRequestCore(tx, {
  requestId: request.id,
  actorId: managerId,
  status: "triaged",
  linkedJobId: sameProjectJob.id,
  now: new Date("2026-07-29T00:05:00.000Z"),
}));
for (const [status, now] of [
  ["scheduled", "2026-07-29T00:06:00.000Z"],
  ["in_progress", "2026-07-29T00:07:00.000Z"],
  ["resolved", "2026-07-29T00:08:00.000Z"],
]) {
  await db.transaction((tx) => portal.manageCustomerRequestCore(tx, {
    requestId: request.id,
    actorId: managerId,
    status,
    now: new Date(now),
  }));
}
await db.transaction((tx) => portal.manageCustomerRequestCore(tx, {
  requestId: request.id,
  actorId: managerId,
  status: "in_progress",
  now: new Date("2026-07-29T00:09:00.000Z"),
}));
let [reopened] = await db.select().from(serviceCustomerRequests)
  .where(eq(serviceCustomerRequests.id, request.id));
if (reopened.status !== "in_progress" || reopened.resolvedAt !== null) {
  throw new Error("reopened request kept a stopped resolution SLA clock");
}
let unlinkRejected = false;
try {
  await db.transaction((tx) => portal.manageCustomerRequestCore(tx, {
    requestId: request.id,
    actorId: managerId,
    linkedJobId: null,
    now: new Date("2026-07-29T00:10:00.000Z"),
  }));
} catch (error) {
  unlinkRejected = error instanceof Error && error.message === "CUSTOMER_REQUEST_JOB_REQUIRED";
}
if (!unlinkRejected) throw new Error("operational request was allowed to unlink its job");

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

const cleanupPath = `${request.id}/orphan.jpg`;
await db.insert(serviceCustomerRequestStorageCleanup).values({
  requestId: request.id,
  bucket: "service-customer-request-evidence",
  path: cleanupPath,
  notBefore: new Date("2026-07-29T00:00:00.000Z"),
});
const removed = [];
const cleanupFirst = await portal.drainCustomerRequestStorageCleanup({
  database: db,
  storage: { remove: async (bucket, path) => removed.push(`${bucket}/${path}`) },
  now: new Date("2026-07-29T01:00:00.000Z"),
  limit: 10,
});
const cleanupReplay = await portal.drainCustomerRequestStorageCleanup({
  database: db,
  storage: { remove: async () => { throw new Error("must not retry acknowledged cleanup"); } },
  now: new Date("2026-07-29T01:01:00.000Z"),
  limit: 10,
});
if (cleanupFirst.cleaned !== 1 || cleanupReplay.cleaned !== 0 || removed.length !== 1) {
  throw new Error("storage cleanup was not claim-safe and idempotent");
}
await db.insert(serviceCustomerRequestStorageCleanup).values({
  requestId: request.id,
  bucket: "service-customer-request-evidence",
  path: `${request.id}/retry.jpg`,
  notBefore: new Date("2026-07-29T01:00:00.000Z"),
});
const failedCleanup = await portal.drainCustomerRequestStorageCleanup({
  database: db,
  storage: { remove: async () => { throw new Error("temporary storage failure"); } },
  now: new Date("2026-07-29T01:01:00.000Z"),
  limit: 10,
});
const [retryState] = await db.select().from(serviceCustomerRequestStorageCleanup)
  .where(eq(serviceCustomerRequestStorageCleanup.path, `${request.id}/retry.jpg`));
if (
  failedCleanup.failed !== 1
  || retryState.attempts !== 1
  || retryState.claimToken !== null
  || retryState.claimedAt !== null
) throw new Error("failed cleanup did not release its claim for retry");
const retryTooEarly = await portal.drainCustomerRequestStorageCleanup({
  database: db,
  storage: { remove: async () => { throw new Error("retry ran before backoff"); } },
  now: new Date("2026-07-29T01:05:59.000Z"),
  limit: 10,
});
const retrySucceeded = await portal.drainCustomerRequestStorageCleanup({
  database: db,
  storage: { remove: async () => undefined },
  now: new Date("2026-07-29T01:06:00.000Z"),
  limit: 10,
});
if (retryTooEarly.evaluated !== 0 || retrySucceeded.cleaned !== 1) {
  throw new Error("cleanup retry/backoff was not idempotent");
}

const atomicRawToken = token.createCustomerRequestToken();
const [atomicRequest] = await db.insert(serviceCustomerRequests).values({
  code: "YC-PORTAL-ATOMIC",
  projectId: project.id,
  title: "Atomic request",
  contactName: "Customer",
  tokenHash: token.hashCustomerRequestToken(atomicRawToken),
  tokenExpiresAt: new Date("2026-08-01T00:00:00.000Z"),
}).returning();
const [atomicCleanup] = await db.transaction((tx) =>
  portal.stageCustomerRequestStorageCleanupCore(tx, {
    requestId: atomicRequest.id,
    objects: [{
      bucket: "service-customer-request-evidence",
      path: `${atomicRequest.id}/atomic.jpg`,
    }],
    now: new Date("2026-07-29T00:00:00.000Z"),
  }));
await db.transaction((tx) => portal.submitCustomerRequestCore(tx, {
  requestId: atomicRequest.id,
  title: "Atomic photo request",
  description: "Photo and request commit together",
  contactName: "Customer",
  contactPhone: "0900000000",
  priority: "normal",
  now: new Date("2026-07-29T00:01:00.000Z"),
  responseMinutes: 60,
  resolutionMinutes: 120,
  attachments: [{
    cleanupId: atomicCleanup.id,
    bucket: atomicCleanup.bucket,
    path: atomicCleanup.path,
    fileName: "atomic.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 100,
    width: 10,
    height: 10,
    sha256: "c".repeat(64),
  }],
}));
const [atomicSubmitted] = await db.select().from(serviceCustomerRequests)
  .where(eq(serviceCustomerRequests.id, atomicRequest.id));
const atomicAttachments = await db.select().from(serviceCustomerRequestAttachments)
  .where(eq(serviceCustomerRequestAttachments.requestId, atomicRequest.id));
const atomicCleanupRows = await db.select().from(serviceCustomerRequestStorageCleanup)
  .where(eq(serviceCustomerRequestStorageCleanup.requestId, atomicRequest.id));
if (!atomicSubmitted.submittedAt || atomicAttachments.length !== 1 || atomicCleanupRows.length !== 0) {
  throw new Error("request, evidence metadata, and cleanup acknowledgement were not atomic");
}

const [claimedRequest] = await db.insert(serviceCustomerRequests).values({
  code: "YC-PORTAL-CLAIMED",
  projectId: project.id,
  title: "Claim race",
  contactName: "Customer",
  tokenHash: "e".repeat(64),
  tokenExpiresAt: new Date("2026-08-01T00:00:00.000Z"),
}).returning();
const [claimedCleanup] = await db.transaction((tx) =>
  portal.stageCustomerRequestStorageCleanupCore(tx, {
    requestId: claimedRequest.id,
    objects: [{
      bucket: "service-customer-request-evidence",
      path: `${claimedRequest.id}/claimed.jpg`,
    }],
    now: new Date("2026-07-29T00:00:00.000Z"),
  }));
await db.update(serviceCustomerRequestStorageCleanup).set({
  claimToken: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  claimedAt: new Date("2026-07-29T00:16:00.000Z"),
}).where(eq(serviceCustomerRequestStorageCleanup.id, claimedCleanup.id));
let claimedFinalizeRejected = false;
try {
  await db.transaction((tx) => portal.submitCustomerRequestCore(tx, {
    requestId: claimedRequest.id,
    title: "Claim race",
    description: "Cleanup already owns the staged object",
    contactName: "Customer",
    contactPhone: "0900000000",
    priority: "normal",
    now: new Date("2026-07-29T00:16:01.000Z"),
    responseMinutes: 60,
    resolutionMinutes: 120,
    attachments: [{
      cleanupId: claimedCleanup.id,
      bucket: claimedCleanup.bucket,
      path: claimedCleanup.path,
      fileName: "claimed.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 100,
      width: 10,
      height: 10,
      sha256: "f".repeat(64),
    }],
  }));
} catch (error) {
  claimedFinalizeRejected = error instanceof Error
    && error.message === "CUSTOMER_REQUEST_STORAGE_CLEANUP_CLAIMED";
}
if (!claimedFinalizeRejected) {
  throw new Error("request finalized while cleanup owned its storage object");
}

const [failedRequest] = await db.insert(serviceCustomerRequests).values({
  code: "YC-PORTAL-PARTIAL",
  projectId: project.id,
  title: "Partial upload",
  contactName: "Customer",
  tokenHash: "d".repeat(64),
  tokenExpiresAt: new Date("2026-08-01T00:00:00.000Z"),
}).returning();
await db.transaction((tx) => portal.stageCustomerRequestStorageCleanupCore(tx, {
  requestId: failedRequest.id,
  objects: [
    { bucket: "service-customer-request-evidence", path: `${failedRequest.id}/first.jpg` },
    { bucket: "service-customer-request-evidence", path: `${failedRequest.id}/second.jpg` },
  ],
  now: new Date("2026-07-29T00:00:00.000Z"),
}));
const [failedStillPrivate] = await db.select().from(serviceCustomerRequests)
  .where(eq(serviceCustomerRequests.id, failedRequest.id));
const failedAttachments = await db.select().from(serviceCustomerRequestAttachments)
  .where(eq(serviceCustomerRequestAttachments.requestId, failedRequest.id));
if (failedStillPrivate.submittedAt || failedAttachments.length !== 0) {
  throw new Error("partial upload became manager-visible before final transaction");
}
let partialManageRejected = false;
try {
  await db.transaction((tx) => portal.manageCustomerRequestCore(tx, {
    requestId: failedRequest.id,
    actorId: managerId,
    status: "triaged",
  }));
} catch (error) {
  partialManageRejected = error instanceof Error && error.message === "CUSTOMER_REQUEST_NOT_FOUND";
}
if (!partialManageRejected) throw new Error("manager could triage an unsubmitted partial upload");
const partialRemoved = [];
const partialCleanup = await portal.drainCustomerRequestStorageCleanup({
  database: db,
  storage: { remove: async (_bucket, path) => partialRemoved.push(path) },
  now: new Date("2026-07-29T00:16:00.000Z"),
  limit: 10,
});
if (partialCleanup.cleaned !== 2 || partialRemoved.length !== 2) {
  throw new Error("partial multi-file upload was not durably recoverable");
}

let directUnlinkRejected = false;
try {
  await db.update(serviceCustomerRequests).set({ linkedJobId: null })
    .where(eq(serviceCustomerRequests.id, request.id));
} catch {
  directUnlinkRejected = true;
}
if (!directUnlinkRejected) throw new Error("database allowed an operational request without a linked job");
let directCrossProjectRejected = false;
try {
  await db.update(serviceCustomerRequests).set({ linkedJobId: foreignJob.id })
    .where(eq(serviceCustomerRequests.id, request.id));
} catch {
  directCrossProjectRejected = true;
}
if (!directCrossProjectRejected) throw new Error("database allowed a cross-project request job");

const acl = await client.query(`
  select c.relname, c.relrowsecurity,
    has_table_privilege('anon', c.oid, 'select') as anon_select,
    has_table_privilege('authenticated', c.oid, 'select') as authenticated_select
  from pg_class c
  where c.relname in ('service_customer_request_attachments', 'service_public_rate_limits', 'service_customer_request_storage_cleanup')
`);
if (acl.rows.length !== 3 || acl.rows.some((row) => !row.relrowsecurity || row.anon_select || row.authenticated_select)) {
  throw new Error("portal security tables must have RLS and no direct client read grants");
}

console.log("customer request portal: one-time submit, manager notifications, durable rate limits, private evidence, and ACL verified");
