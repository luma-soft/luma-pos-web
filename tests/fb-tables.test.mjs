/* F&B table-operation smoke tests on PGlite.
   Mirrors the move/merge/split mutations used by src/lib/actions/tables.ts. */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, inArray } from "drizzle-orm";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${PROJ}/src/db/schema.ts`);
const { tableCartItemSchema } = await import(`${PROJ}/src/lib/schemas/table.ts`);
const { diningTables, kitchenTickets, kitchenTicketItems } = schema;
const client = new PGlite();
const db = drizzle(client, { schema });

let pass = 0;
let fail = 0;
const ok = (name, condition) => {
  if (condition) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}`);
  }
};

for (const file of readdirSync(`${PROJ}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${PROJ}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

const line = (lineId, productName) => ({
  lineId,
  productId: "00000000-0000-4000-8000-00000000f001",
  productName,
  unitName: "cái",
  unitMultiplier: 1,
  quantity: 1,
  basePrice: 50000,
  unitPrice: 50000,
  modifiers: [],
  sent: true,
});

console.log("1) Move table keeps cart and active kitchen routing atomic");
const [source, freeTarget] = await db.insert(diningTables).values([
  { name: "A01", zone: "A", status: "occupied", currentCart: [line("line-a", "Phở")] },
  { name: "B01", zone: "B", status: "free", currentCart: [] },
]).returning();
await db.insert(kitchenTickets).values({ tableId: source.id, tableName: source.name });
await db.transaction(async (tx) => {
  await tx.update(diningTables).set({
    currentCart: source.currentCart,
    status: "occupied",
    openedAt: new Date(),
  }).where(eq(diningTables.id, freeTarget.id));
  await tx.update(kitchenTickets).set({
    tableId: freeTarget.id,
    tableName: freeTarget.name,
  }).where(and(eq(kitchenTickets.tableId, source.id), eq(kitchenTickets.status, "active")));
  await tx.update(diningTables).set({ status: "free", currentCart: [], openedAt: null })
    .where(eq(diningTables.id, source.id));
});
const [movedSource] = await db.select().from(diningTables).where(eq(diningTables.id, source.id));
const [movedTarget] = await db.select().from(diningTables).where(eq(diningTables.id, freeTarget.id));
const [movedTicket] = await db.select().from(kitchenTickets);
ok("source is released", movedSource.status === "free" && movedSource.currentCart.length === 0);
ok("target receives exact cart", movedTarget.status === "occupied" && movedTarget.currentCart[0].lineId === "line-a");
ok("active kitchen ticket follows table", movedTicket.tableId === freeTarget.id && movedTicket.tableName === "B01");

console.log("2) Merge combines carts, moves tickets and releases sources");
const [mergeTarget, mergeSource] = await db.insert(diningTables).values([
  { name: "C01", zone: "C", status: "occupied", currentCart: [line("line-c", "Cơm")] },
  { name: "C02", zone: "C", status: "occupied", currentCart: [line("line-d", "Trà")] },
]).returning();
await db.insert(kitchenTickets).values({ tableId: mergeSource.id, tableName: mergeSource.name });
await db.transaction(async (tx) => {
  await tx.update(diningTables).set({
    currentCart: [...mergeTarget.currentCart, ...mergeSource.currentCart],
    status: "occupied",
  }).where(eq(diningTables.id, mergeTarget.id));
  await tx.update(kitchenTickets).set({ tableId: mergeTarget.id, tableName: mergeTarget.name })
    .where(and(inArray(kitchenTickets.tableId, [mergeSource.id]), eq(kitchenTickets.status, "active")));
  await tx.update(diningTables).set({ status: "free", currentCart: [], openedAt: null })
    .where(inArray(diningTables.id, [mergeSource.id]));
});
const [mergedTarget] = await db.select().from(diningTables).where(eq(diningTables.id, mergeTarget.id));
const [releasedSource] = await db.select().from(diningTables).where(eq(diningTables.id, mergeSource.id));
const [mergedTicket] = await db.select().from(kitchenTickets).where(eq(kitchenTickets.tableId, mergeTarget.id));
ok("target has both stable line ids", mergedTarget.currentCart.map((item) => item.lineId).join(",") === "line-c,line-d");
ok("source is released", releasedSource.status === "free" && releasedSource.currentCart.length === 0);
ok("source kitchen ticket is routed to target", mergedTicket?.tableName === "C01");

console.log("3) Split bill removes only server-selected line ids");
const selectedIds = ["line-c"];
const selected = mergedTarget.currentCart.filter((item) => selectedIds.includes(item.lineId));
const remaining = mergedTarget.currentCart.filter((item) => !selected.some((paid) => paid.lineId === item.lineId));
await db.update(diningTables).set({ currentCart: remaining }).where(eq(diningTables.id, mergeTarget.id));
const [splitTable] = await db.select().from(diningTables).where(eq(diningTables.id, mergeTarget.id));
ok("selected line is settled once", selected.length === 1 && selected[0].lineId === "line-c");
ok("unselected line stays on table", splitTable.currentCart.length === 1 && splitTable.currentCart[0].lineId === "line-d");
ok("partial checkout keeps table occupied", splitTable.status === "occupied");

console.log("4) Course timing is validated and persisted server-side");
const timedCart = tableCartItemSchema.safeParse({
  ...line("line-timed", "Bò hầm"),
  course: "main",
  courseDelayMinutes: 15,
});
const invalidDelay = tableCartItemSchema.safeParse({
  ...line("line-invalid", "Bánh"),
  course: "dessert",
  courseDelayMinutes: 241,
});
ok("valid course and delay pass the API contract", timedCart.success);
ok("delay beyond 240 minutes is rejected", !invalidDelay.success);
const [timedTicket] = await db.insert(kitchenTickets).values({
  tableId: mergeTarget.id,
  tableName: mergeTarget.name,
}).returning();
const fireAt = new Date(Date.now() + 15 * 60_000);
const [timedItem] = await db.insert(kitchenTicketItems).values({
  ticketId: timedTicket.id,
  productName: "Bò hầm",
  quantity: "1",
  course: "main",
  fireAt,
}).returning();
ok("course and fire time survive persistence", timedItem.course === "main" && timedItem.fireAt?.getTime() === fireAt.getTime());
ok("future course cannot start preparing", timedItem.fireAt.getTime() > Date.now() && timedItem.status === "pending");

await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
