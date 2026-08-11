import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function testFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return /\.test\.(?:mjs|ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

async function run(files) {
  if (files.length === 0) return;
  const child = Bun.spawn([process.execPath, "test", ...files], {
    cwd: process.cwd(),
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await child.exited;
  if (status !== 0) process.exit(status);
}

const files = testFiles("tests").sort();
const pgliteFiles = files.filter((file) =>
  readFileSync(file, "utf8").includes("new PGlite("),
);
const regularFiles = files.filter((file) => !pgliteFiles.includes(file));

for (const file of regularFiles) await run([file]);
for (const file of pgliteFiles) await run([file]);
