import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, expect, mock, test } from "bun:test";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const { orders, projects } = schema;
const client = new PGlite();
const db = drizzle(client, { schema });

await client.exec("create role anon; create role authenticated;");
for (const file of readdirSync(`${projectRoot}/drizzle`)
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  const migration = readFileSync(`${projectRoot}/drizzle/${file}`, "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

mock.module("@/db", () => ({ db, schema }));
const { getServiceDashboard, getServiceProjectsPage } = await import(
  `${projectRoot}/src/lib/data/services.ts`
);

afterAll(async () => {
  mock.restore();
  await client.close();
});

test("service project rows expose the financial summary required by mobile", async () => {
  const [project] = await db
    .insert(projects)
    .values({
      name: "Chị Hậu Gạo - Camera",
      status: "done",
      serviceType: "camera",
      serviceStage: "completed",
      progressPercent: "100",
    })
    .returning();

  await db.insert(orders).values({
    code: "HD-SERVICE-CONTRACT-001",
    status: "completed",
    projectId: project.id,
    total: "120000",
    amountPaid: "20000",
  });

  const dashboard = await getServiceDashboard(project.storeId);
  const row = dashboard.projects.find((item) => item.id === project.id);

  expect(row).toBeDefined();
  expect(row?.status).toBe("done");
  expect(row?.orderCount).toBe(1);
  expect(Number(row?.totalValue)).toBe(120000);
  expect(Number(row?.remaining)).toBe(100000);
});

test("deadline summaries are disjoint and urgency filters return matching projects", async () => {
  const { rows: [{ today }] } = await client.query(
    "select current_date::text as today",
  );
  const shiftDate = (days) => {
    const value = new Date(`${today}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };

  const [overdue] = await db.insert(projects).values({
    name: "Camera overdue paused",
    status: "active",
    serviceType: "camera",
    serviceStage: "paused",
    targetEndsOn: shiftDate(-2),
  }).returning();
  await db.insert(projects).values([
    {
      storeId: overdue.storeId,
      name: "Camera due soon",
      status: "active",
      serviceType: "camera",
      serviceStage: "active",
      targetEndsOn: shiftDate(2),
    },
    {
      storeId: overdue.storeId,
      name: "Camera completed late",
      status: "done",
      serviceType: "camera",
      serviceStage: "completed",
      targetEndsOn: shiftDate(-5),
    },
    {
      storeId: overdue.storeId,
      name: "Camera completed stage",
      status: "active",
      serviceType: "camera",
      serviceStage: "completed",
      targetEndsOn: shiftDate(-6),
    },
    {
      storeId: overdue.storeId,
      name: "Camera later",
      status: "active",
      serviceType: "camera",
      serviceStage: "active",
      targetEndsOn: shiftDate(10),
    },
  ]);

  const all = await getServiceProjectsPage(overdue.storeId);
  expect(all.summary).toEqual({ attention: 1, overdue: 1 });

  const overduePage = await getServiceProjectsPage(overdue.storeId, {
    urgency: "overdue",
  });
  expect(overduePage.rows.map((row) => row.name)).toEqual([
    "Camera overdue paused",
  ]);
  expect(overduePage.summary).toEqual({ attention: 1, overdue: 1 });

  const attentionPage = await getServiceProjectsPage(overdue.storeId, {
    urgency: "attention",
  });
  expect(attentionPage.rows.map((row) => row.name)).toEqual([
    "Camera due soon",
  ]);
  expect(attentionPage.summary).toEqual({ attention: 1, overdue: 1 });
});
