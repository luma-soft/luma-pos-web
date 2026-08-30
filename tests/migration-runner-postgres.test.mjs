import { expect, test } from "bun:test";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const {
  createMigrationPostgresClient,
  MIGRATION_POOL_END_TIMEOUT_SECONDS,
  readMigrationDatabaseUrl,
  runMigrationChain,
} = await import(`${projectRoot}/src/db/migration-runner.ts`);

const testDatabaseUrl = process.env.TEST_MIGRATION_DATABASE_URL?.trim();
const postgresTest = testDatabaseUrl ? test : test.skip;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

postgresTest("two reserved PostgreSQL sessions serialize and recheck tracking", async () => {
  const databaseConfig = readMigrationDatabaseUrl({
    MIGRATION_DATABASE_URL: testDatabaseUrl,
  });
  const sql = createMigrationPostgresClient(databaseConfig, { maxConnections: 3 });
  expect(sql.options.max_lifetime).toBeNull();
  const schema = `migration_runner_${crypto.randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let firstConnection;
  let secondConnection;
  let firstRun;
  let secondRun;
  let releaseFirst;

  try {
    await sql.unsafe(`create schema ${quotedSchema}`);
    firstConnection = await sql.reserve();
    secondConnection = await sql.reserve();

    const [firstPidRows, secondPidRows] = await Promise.all([
      firstConnection.unsafe("select pg_backend_pid() as backend_pid"),
      secondConnection.unsafe("select pg_backend_pid() as backend_pid"),
    ]);
    expect(firstPidRows[0].backend_pid).not.toBe(secondPidRows[0].backend_pid);

    const firstConfigured = deferred();
    releaseFirst = deferred();
    const migrations = [{
      name: "real-two-runner.sql",
      content: "create table runner_effect (id integer primary key); insert into runner_effect values (1);",
    }];

    firstRun = runMigrationChain(firstConnection, migrations, {
      afterLockAcquired: async (connection) => {
        await connection.unsafe(`set search_path to ${quotedSchema}`);
        firstConfigured.resolve();
        await releaseFirst.promise;
      },
      sleep: async () => {},
    });
    await Promise.race([
      firstConfigured.promise,
      firstRun.then(
        () => Promise.reject(new Error("first runner finished before its configure gate")),
        (error) => Promise.reject(error),
      ),
    ]);

    let secondSettled = false;
    secondRun = runMigrationChain(secondConnection, migrations, {
      afterLockAcquired: async (connection) => {
        await connection.unsafe(`set search_path to ${quotedSchema}`);
      },
      sleep: async () => {},
    }).finally(() => { secondSettled = true; });
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    releaseFirst.resolve();
    expect(await firstRun).toEqual({ applied: ["real-two-runner.sql"], skipped: [] });
    expect(await secondRun).toEqual({ applied: [], skipped: ["real-two-runner.sql"] });

    expect(await sql.unsafe(`select count(*)::int as count from ${quotedSchema}.runner_effect`))
      .toEqual([{ count: 1 }]);
    expect(await sql.unsafe(`select name from ${quotedSchema}._migrations order by name`))
      .toEqual([{ name: "real-two-runner.sql" }]);
  } finally {
    releaseFirst?.resolve();
    await Promise.allSettled([firstRun, secondRun].filter(Boolean));
    try {
      firstConnection?.release();
    } finally {
      secondConnection?.release();
    }
    try {
      await sql.unsafe(`drop schema if exists ${quotedSchema} cascade`);
    } finally {
      await sql.end({ timeout: MIGRATION_POOL_END_TIMEOUT_SECONDS });
    }
  }
});
