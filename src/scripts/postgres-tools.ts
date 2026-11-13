import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

export type PostgreSqlUtility = "pg_dump" | "pg_restore";

export function resolvePostgresUtility(
  utility: PostgreSqlUtility,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configuredDirectory = environment.LUMAPOS_POSTGRES_BIN_DIR?.trim();
  if (configuredDirectory) {
    if (!path.isAbsolute(configuredDirectory)) {
      throw new Error("LUMAPOS_POSTGRES_BIN_DIR must be an absolute path");
    }
    const configuredPath = path.join(configuredDirectory, utility);
    if (!existsSync(configuredPath)) throw new Error("POSTGRES_TOOL_NOT_FOUND");
    return configuredPath;
  }

  const brewPrefix = spawnSync("brew", ["--prefix", "postgresql@17"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const prefix = brewPrefix.status === 0 ? brewPrefix.stdout.trim() : "";
  if (prefix) {
    const homebrewPath = path.join(prefix, "bin", utility);
    if (existsSync(homebrewPath)) return homebrewPath;
  }
  return utility;
}

export function postgresUtilityMajorVersion(utilityPath: string) {
  const result = spawnSync(utilityPath, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: process.env.NODE_ENV ?? "production",
    },
  });
  if (result.status !== 0) throw new Error("POSTGRES_TOOL_UNAVAILABLE");
  const major = result.stdout.match(/\)\s*(\d+)\./)?.[1];
  if (!major) throw new Error("POSTGRES_TOOL_VERSION_UNKNOWN");
  return Number(major);
}
