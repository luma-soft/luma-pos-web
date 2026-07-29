import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const workerPath = fileURLToPath(
  new URL("./sepay-webhook-route.worker.mjs", import.meta.url),
);
const result = spawnSync(process.execPath, [workerPath], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: process.env,
  encoding: "utf8",
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
