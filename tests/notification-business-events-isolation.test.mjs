import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const common = await import(`${projectRoot}/src/lib/actions/common.ts`);

if (
  typeof common.requireRole !== "function"
  || typeof common.getRole !== "function"
  || typeof common.pgErrorCode !== "function"
) {
  throw new Error("notification business-event mocks leaked into the shared process");
}

console.log("notification business-event isolation: real action exports preserved");
