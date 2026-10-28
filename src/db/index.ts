import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

function getNodePostgresConnectionString(value: string) {
  const url = new URL(value);

  // Supabase pooler URLs use libpq's `sslmode=require` contract: encrypt the
  // connection without requiring the pooler's certificate to chain to Node's
  // default trust store. pg-connection-string 2.14 changed the default mapping
  // to verify-full; opt into its documented libpq-compatible mapping instead.
  if (url.hostname.endsWith(".pooler.supabase.com") && url.searchParams.has("sslmode")) {
    url.searchParams.set("uselibpqcompat", "true");
  }

  return url.toString();
}

// Runtime app dùng Supabase transaction pooler (:6543). `pg` không tạo named
// prepared statements nếu query không có `name`, nên tương thích transaction mode.
const pool = new Pool({
  connectionString: getNodePostgresConnectionString(connectionString),
  // Giới hạn pool phía app; Supavisor tiếp tục chia sẻ backend connections.
  max: process.env.NODE_ENV === "production" ? 3 : 10,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  maxLifetimeSeconds: 30 * 60,
  keepAlive: true,
});

// Fluid Compute có thể đóng băng instance giữa hai request. Helper này đóng các
// connection nhàn rỗi trước khi suspend để lần gọi sau không tái dùng TCP socket
// đã chết (nguyên nhân query treo đến giới hạn 300 giây của Vercel).
if (process.env.VERCEL) {
  attachDatabasePool(pool);
}

pool.on("error", (error) => {
  console.error("Unexpected idle database connection error", error);
});

export const db = drizzle(pool, { schema });
export { schema };
