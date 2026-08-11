import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const previousDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const common = await import(`${projectRoot}/src/lib/actions/common.ts`);
if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
else process.env.DATABASE_URL = previousDatabaseUrl;

if (
  typeof common.requireRole !== "function"
  || typeof common.getRole !== "function"
  || typeof common.pgErrorCode !== "function"
) {
  throw new Error("notification business-event mocks leaked into the shared process");
}

console.log("notification business-event isolation: real action exports preserved");
