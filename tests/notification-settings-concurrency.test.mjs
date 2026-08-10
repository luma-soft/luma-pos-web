import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
import {
  persistNotificationSettingsPatch,
  persistStorePrefsPatch,
} from "../src/lib/settings/notification-settings-core.ts";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const STORE_ID = "00000000-0000-4000-8000-000000000001";
const client = new PGlite();
const database = drizzle(client, { schema });
await client.exec("create role anon; create role authenticated;");

for (
  const file of readdirSync(`${projectRoot}/drizzle`)
    .filter((name) => name.endsWith(".sql"))
    .sort()
) {
  for (
    const statement of readFileSync(
      `${projectRoot}/drizzle/${file}`,
      "utf8",
    ).split("--> statement-breakpoint")
  ) {
    const sql = statement.trim();
    if (sql && !/create extension|gin_trgm_ops/i.test(sql)) await client.exec(sql);
  }
}

let firstReadCount = 0;
let releaseFirstReads;
const firstReadsReady = new Promise((resolve) => {
  releaseFirstReads = resolve;
});

function wrapBuilder(builder, readsStoreSettings = false) {
  return new Proxy(builder, {
    get(target, property, receiver) {
      if (property === "from") {
        return (table) => wrapBuilder(
          target.from(table),
          table === schema.storeSettings,
        );
      }
      if (property === "then" && readsStoreSettings) {
        return (resolve, reject) => target.then(async (rows) => {
          if (firstReadCount < 2) {
            firstReadCount += 1;
            if (firstReadCount === 2) releaseFirstReads();
            await firstReadsReady;
          }
          return resolve(rows);
        }, reject);
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function"
        ? (...args) => wrapBuilder(value.apply(target, args), readsStoreSettings)
        : value;
    },
  });
}

const synchronizedDatabase = new Proxy(database, {
  get(target, property, receiver) {
    if (property === "select") {
      return (...args) => wrapBuilder(target.select(...args));
    }
    const value = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

await Promise.all([
  persistNotificationSettingsPatch(synchronizedDatabase, STORE_ID, {
    invoiceCreated: false,
  }),
  persistStorePrefsPatch(synchronizedDatabase, STORE_ID, {
    hardware: {
      paperSize: "A4",
      autoPrint: true,
      openDrawer: false,
      printEinvoiceQr: false,
    },
  }),
]);

const [saved] = await database
  .select({ prefs: schema.storeSettings.prefs })
  .from(schema.storeSettings)
  .where(eq(schema.storeSettings.storeId, STORE_ID));

assert.equal(saved.prefs.notifications.invoiceCreated, false);
assert.equal(saved.prefs.notifications.purchaseReceived, true);
assert.equal(saved.prefs.notifications.debtChanged, true);
assert.deepEqual(saved.prefs.hardware, {
  paperSize: "A4",
  autoPrint: true,
  openDrawer: false,
  printEinvoiceQr: false,
});

await client.close();
console.log("✅ legacy web prefs and mobile notification CAS writes preserve both intents");
