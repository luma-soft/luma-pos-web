import { loadEnvConfig } from "@next/env";
import { assertSelfHostedPrimaryDatabase } from "@/db/self-hosted-primary";

loadEnvConfig(process.cwd());

const taskArgument = process.argv.find((value) => value.startsWith("--task="));
const task = taskArgument?.slice("--task=".length);
const route = task === "notifications"
  ? "/api/cron/notifications"
  : task === "media-cleanup"
    ? "/api/cron/media/cleanup"
    : task === "einvoices"
      ? "/api/cron/einvoices"
      : null;
if (!route) throw new Error("Pass --task=notifications, --task=media-cleanup, or --task=einvoices");
if (process.env.LUMAPOS_AUTH_PROVIDER !== "lumapos") {
  throw new Error("Self-hosted maintenance requires LUMAPOS_AUTH_PROVIDER=lumapos");
}
assertSelfHostedPrimaryDatabase(process.env);

const internalUrl = process.env.LUMAPOS_INTERNAL_URL?.trim();
if (!internalUrl) throw new Error("LUMAPOS_INTERNAL_URL is not configured");
let baseUrl: URL;
try {
  baseUrl = new URL(internalUrl);
} catch {
  throw new Error("LUMAPOS_INTERNAL_URL is invalid");
}
if (
  baseUrl.protocol !== "http:"
  || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(baseUrl.hostname)
  || baseUrl.username
  || baseUrl.password
  || baseUrl.pathname !== "/"
  || baseUrl.search
  || baseUrl.hash
) {
  throw new Error("LUMAPOS_INTERNAL_URL must be an HTTP loopback origin");
}
const cronSecret = process.env.CRON_SECRET?.trim();
if (!cronSecret) throw new Error("CRON_SECRET is not configured");

const response = await fetch(new URL(route, baseUrl), {
  method: "GET",
  headers: { Authorization: `Bearer ${cronSecret}` },
  cache: "no-store",
  signal: AbortSignal.timeout(300_000),
});
if (!response.ok) {
  throw new Error(`Maintenance task ${task} failed with HTTP ${response.status}`);
}
console.log(`Maintenance task ${task} completed.`);
