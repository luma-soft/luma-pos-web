import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const { profiles, projects, serviceJobAssignments, serviceJobs, stores } = schema;
const { createDatabaseMediaAuthorizationRepository } = await import(
  `${projectRoot}/src/lib/media/authorization-repository.ts`
);

const client = new PGlite();
const database = drizzle(client, { schema });

const STORE_A = "00000000-0000-4000-8000-000000000001";
const STORE_B = "82000000-0000-4000-8000-000000000002";
const TECHNICIAN_A = "82000000-0000-4000-8000-000000000003";
const PROJECT_A = "82000000-0000-4000-8000-000000000004";
const JOB_A = "82000000-0000-4000-8000-000000000005";

beforeAll(async () => {
  await client.exec("create role anon; create role authenticated;");
  for (const file of readdirSync(`${projectRoot}/drizzle`)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    for (const statement of readFileSync(`${projectRoot}/drizzle/${file}`, "utf8")
      .split("--> statement-breakpoint")) {
      const sql = statement.trim();
      if (sql && !/create extension|gin_trgm_ops/i.test(sql)) await client.exec(sql);
    }
  }

  await database.insert(stores).values({ id: STORE_B, slug: "media-auth-store-b" });
  await database.insert(profiles).values({
    id: TECHNICIAN_A,
    storeId: STORE_A,
    fullName: "Technician A",
    role: "technician",
  });
  await database.insert(projects).values({
    id: PROJECT_A,
    storeId: STORE_A,
    name: "Tenant scoped project",
    serviceType: "camera",
  });
  await database.insert(serviceJobs).values({
    id: JOB_A,
    storeId: STORE_A,
    projectId: PROJECT_A,
    code: "MEDIA-AUTH-1",
    serviceType: "camera",
    title: "Tenant scoped job",
  });
  // The legacy assignment schema permits this inconsistent coordinate. The
  // authorization query itself must still fail closed on store_id.
  await database.insert(serviceJobAssignments).values({
    storeId: STORE_B,
    jobId: JOB_A,
    profileId: TECHNICIAN_A,
  });
});

afterAll(async () => client.close());

describe("database media authorization tenant coordinates", () => {
  test("cross-store assignment cannot grant direct job or correlated project access", async () => {
    const repository = createDatabaseMediaAuthorizationRepository(database);

    expect(await repository.technicianAssignedToJob(STORE_A, JOB_A, TECHNICIAN_A))
      .toBe(false);
    expect(await repository.technicianCanAccessProject(STORE_A, PROJECT_A, TECHNICIAN_A))
      .toBe(false);

    await database.update(serviceJobAssignments).set({ storeId: STORE_A });
    expect(await repository.technicianAssignedToJob(STORE_A, JOB_A, TECHNICIAN_A))
      .toBe(true);
    expect(await repository.technicianCanAccessProject(STORE_A, PROJECT_A, TECHNICIAN_A))
      .toBe(true);
  });
});
