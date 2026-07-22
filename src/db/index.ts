import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Runtime app dùng Supabase transaction pooler (:6543). `pg` không tạo named
// prepared statements nếu query không có `name`, nên tương thích transaction mode.
const pool = new Pool({
  connectionString,
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
