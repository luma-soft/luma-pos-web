import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const {
  applyMigrationFileAtomically,
  MIGRATION_ADVISORY_LOCK_KEY,
  runMigrationChain,
  splitMigrationStatements,
  transactionalizeMigrationStatement,
} = await import(
  `${projectRoot}/src/db/migration-runner.ts`
);

const database = new PGlite();
const connection = {
  async unsafe(statement, parameters = []) {
    if (parameters.length) {
      return (await database.query(statement, parameters)).rows;
    }
    return database.exec(statement);
  },
};

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

class AdvisoryLockHarness {
  owner = null;
  waiters = [];

  async acquire(owner, key) {
    if (key !== MIGRATION_ADVISORY_LOCK_KEY) throw new Error(`unexpected lock key ${key}`);
    if (this.owner === null) {
      this.owner = owner;
      return;
    }
    const ready = deferred();
    this.waiters.push({ owner, ready });
    await ready.promise;
  }

  release(owner, key) {
    if (key !== MIGRATION_ADVISORY_LOCK_KEY || this.owner !== owner) {
      throw new Error("advisory unlock ownership mismatch");
    }
    const next = this.waiters.shift();
    if (next) {
      this.owner = next.owner;
      next.ready.resolve();
    } else {
      this.owner = null;
    }
  }
}

class DatabaseLockHarness {
  owner = null;
  waiters = [];

  async acquire(owner) {
    if (this.owner === null) {
      this.owner = owner;
      return;
    }
    const ready = deferred();
    this.waiters.push({ owner, ready });
    await ready.promise;
  }

  release(owner) {
    if (this.owner !== owner) throw new Error("database lock ownership mismatch");
    const next = this.waiters.shift();
    if (next) {
      this.owner = next.owner;
      next.ready.resolve();
    } else {
      this.owner = null;
    }
  }
}

function createRunConnection(name, shared, options = {}) {
  let pendingTracking = null;
  let pendingEffect = false;
  let deadlockThrown = false;
  let databaseLockHeld = false;
  return {
    async unsafe(statement, parameters = []) {
      const normalized = statement.trim().replace(/\s+/g, " ").toLowerCase();
      shared.events.push(`${name}:${normalized.split(" ").slice(0, 3).join(" ")}`);
      if (normalized.startsWith("select pg_advisory_lock")) {
        await shared.lock.acquire(name, parameters[0]);
        shared.events.push(`${name}:lock-acquired`);
        return [{ pg_advisory_lock: null }];
      }
      if (normalized.startsWith("select pg_advisory_unlock")) {
        shared.lock.release(name, parameters[0]);
        shared.events.push(`${name}:lock-released`);
        return [{ pg_advisory_unlock: true }];
      }
      if (normalized.startsWith("create table if")) return [];
      if (normalized === "begin") {
        pendingTracking = null;
        pendingEffect = false;
        return [];
      }
      if (normalized === "rollback") {
        pendingTracking = null;
        pendingEffect = false;
        if (databaseLockHeld) {
          shared.databaseLock.release(name);
          databaseLockHeld = false;
        }
        return [];
      }
      if (normalized === "commit") {
        if (pendingTracking) shared.tracked.add(pendingTracking);
        if (pendingEffect) shared.effectCount++;
        pendingTracking = null;
        pendingEffect = false;
        if (databaseLockHeld) {
          shared.databaseLock.release(name);
          databaseLockHeld = false;
        }
        return [];
      }
      if (normalized.startsWith("select name from _migrations where name =")) {
        return shared.tracked.has(parameters[0]) ? [{ name: parameters[0] }] : [];
      }
      if (normalized.startsWith("select name from _migrations")) {
        return [...shared.tracked].map((trackedName) => ({ name: trackedName }));
      }
      if (normalized.startsWith("insert into _migrations")) {
        pendingTracking = parameters[0];
        return [];
      }
      if (normalized === "select apply_once()") {
        if (options.deadlockOnce && !deadlockThrown) {
          deadlockThrown = true;
          throw Object.assign(new Error("deadlock injected"), { code: "40P01" });
        }
        options.onEffectAttempt?.();
        if (shared.databaseLock) {
          await shared.databaseLock.acquire(name);
          databaseLockHeld = true;
        }
        options.onEffectStart?.();
        if (options.effectGate) await options.effectGate;
        pendingEffect = true;
        return [];
      }
      throw new Error(`unexpected SQL for ${name}: ${statement}`);
    },
  };
}

afterAll(async () => database.close());

describe("production migration runner file atomicity", () => {
  test("a partially applied grouped ALTER hard-fails and remains untracked", async () => {
    const partialDatabase = new PGlite();
    const partialConnection = {
      async unsafe(statement, parameters = []) {
        if (parameters.length) return (await partialDatabase.query(statement, parameters)).rows;
        return partialDatabase.exec(statement);
      },
    };
    try {
      await partialDatabase.exec(`
        create table _migrations (name text primary key, applied_at timestamptz not null default now());
        create table profiles (id uuid primary key);
        create table service_attachments (
          id uuid primary key,
          job_id uuid,
          created_at timestamptz not null default now(),
          deleted_at timestamptz
        );
        create table service_signatures (id uuid primary key, attachment_id uuid not null);
      `);
      const migrationName = "0065_service_attachment_tombstones.sql";
      const migration = readFileSync(`${projectRoot}/drizzle/${migrationName}`, "utf8");

      await expect(applyMigrationFileAtomically(
        partialConnection,
        migrationName,
        migration,
      )).rejects.toThrow(/0065_service_attachment_tombstones\.sql.*statement 1/i);

      expect((await partialDatabase.query(`
        select column_name from information_schema.columns
        where table_name = 'service_attachments'
          and column_name in (
            'deleted_by', 'storage_deleted_at', 'storage_delete_attempts',
            'storage_delete_last_error'
          ) order by column_name
      `)).rows).toEqual([]);
      expect((await partialDatabase.query(`select name from _migrations`)).rows).toEqual([]);
    } finally {
      await partialDatabase.close();
    }
  });

  test("same-name tables, indexes, and constraints with wrong definitions never become tracked", async () => {
    const mismatchDatabase = new PGlite();
    const mismatchConnection = {
      async unsafe(statement, parameters = []) {
        if (parameters.length) return (await mismatchDatabase.query(statement, parameters)).rows;
        return mismatchDatabase.exec(statement);
      },
    };
    try {
      await mismatchDatabase.exec(`
        create table _migrations (name text primary key, applied_at timestamptz not null default now());
        create table wrong_table (wrong text);
        create table index_target (left_value integer, right_value integer);
        create index expected_index on index_target (left_value);
        create table constraint_target (
          value integer,
          constraint expected_constraint check (value >= 0)
        );
      `);
      const cases = [
        ["wrong-table.sql", `create table wrong_table (id integer primary key);`],
        ["wrong-index.sql", `create index expected_index on index_target (right_value);`],
        ["wrong-constraint.sql", `alter table constraint_target
          add constraint expected_constraint check (value > 10);`],
      ];
      for (const [fileName, content] of cases) {
        await expect(applyMigrationFileAtomically(
          mismatchConnection,
          fileName,
          content,
        )).rejects.toThrow(new RegExp(`${fileName}.*statement 1`, "i"));
      }
      expect((await mismatchDatabase.query(`select name from _migrations`)).rows).toEqual([]);
    } finally {
      await mismatchDatabase.close();
    }
  });

  test("clean files apply once while a tracked retry rechecks tracking before executing content", async () => {
    const retryDatabase = new PGlite();
    const retryConnection = {
      async unsafe(statement, parameters = []) {
        if (parameters.length) return (await retryDatabase.query(statement, parameters)).rows;
        return retryDatabase.exec(statement);
      },
    };
    try {
      await retryDatabase.exec(`
        create table _migrations (name text primary key, applied_at timestamptz not null default now());
      `);
      await expect(applyMigrationFileAtomically(
        retryConnection,
        "retry-once.sql",
        `create table retry_once (id integer primary key);`,
      )).resolves.toMatchObject({ status: "applied", statementCount: 1 });
      await expect(applyMigrationFileAtomically(
        retryConnection,
        "retry-once.sql",
        `select must_not_execute_on_tracked_retry();`,
      )).resolves.toEqual({ status: "already-applied", statementCount: 0 });
      expect((await retryDatabase.query(`select count(*)::int count from _migrations`)).rows)
        .toEqual([{ count: 1 }]);
    } finally {
      await retryDatabase.close();
    }
  });

  test("a mid-file failure rolls back DDL and tracking, then a clean retry records once", async () => {
    await database.exec(`
      create table _migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );
      create table runner_atomicity (id integer primary key);
    `);
    const failedMigration = `
      alter table runner_atomicity add column first_value text;
      --> statement-breakpoint
      select missing_failure_injection_function();
      --> statement-breakpoint
      alter table runner_atomicity add column second_value text;
    `;

    await expect(applyMigrationFileAtomically(
      connection,
      "runner-atomicity.sql",
      failedMigration,
    )).rejects.toThrow();

    const afterFailure = await database.query(`
      select column_name from information_schema.columns
      where table_name = 'runner_atomicity'
      order by ordinal_position
    `);
    expect(afterFailure.rows).toEqual([{ column_name: "id" }]);
    expect((await database.query(`select name from _migrations`)).rows).toEqual([]);

    const cleanMigration = failedMigration.replace(
      "select missing_failure_injection_function();",
      "select 1;",
    );
    await expect(applyMigrationFileAtomically(
      connection,
      "runner-atomicity.sql",
      cleanMigration,
    )).resolves.toMatchObject({ statementCount: 3 });

    const afterRetry = await database.query(`
      select column_name from information_schema.columns
      where table_name = 'runner_atomicity'
      order by ordinal_position
    `);
    expect(afterRetry.rows.map((row) => row.column_name)).toEqual([
      "id",
      "first_value",
      "second_value",
    ]);
    expect((await database.query(`select name from _migrations`)).rows)
      .toEqual([{ name: "runner-atomicity.sql" }]);
  });

  test("the ordered chain has a transactional form for every migration file", async () => {
    const chainDatabase = new PGlite();
    const chainConnection = {
      async unsafe(statement, parameters = []) {
        if (parameters.length) {
          return (await chainDatabase.query(statement, parameters)).rows;
        }
        return chainDatabase.exec(statement);
      },
    };
    try {
      await chainDatabase.exec(`
        create role anon;
        create role authenticated;
      `);
      const migrationFiles = readdirSync(`${projectRoot}/drizzle`)
        .filter((name) => name.endsWith(".sql"))
        .sort();
      const migrations = migrationFiles.map((file) => {
        const statements = splitMigrationStatements(
          readFileSync(`${projectRoot}/drizzle/${file}`, "utf8"),
        ).filter((statement) => !/create extension/i.test(statement));
        const transactionalContent = statements
          .map(transactionalizeMigrationStatement)
          // PGlite has no pg_trgm extension; retain and execute each CREATE with
          // the same index name/expression through its built-in btree support.
          .map((statement) => statement
            .replace(/\bUSING\s+gin\s*\(/i, "(")
            .replace(/\s+gin_trgm_ops\b/gi, ""))
          .join("\n--> statement-breakpoint\n");
        expect(transactionalContent).not.toMatch(
          /\b(?:create|drop)\s+(?:unique\s+)?index\s+concurrently\b/i,
        );
        return { name: file, content: transactionalContent };
      });
      expect(await runMigrationChain(
        chainConnection,
        migrations,
        { sleep: async () => {} },
      )).toEqual({ applied: migrationFiles, skipped: [] });
      expect((await chainDatabase.query(`select count(*)::int count from _migrations`)).rows)
        .toEqual([{ count: migrationFiles.length }]);
      expect((await chainDatabase.query(`
        select indexname from pg_indexes
        where indexname in (
          'products_name_accent_trgm_idx',
          'products_sku_accent_trgm_idx',
          'products_barcode_accent_trgm_idx'
        ) order by indexname
      `)).rows).toEqual([
        { indexname: "products_barcode_accent_trgm_idx" },
        { indexname: "products_name_accent_trgm_idx" },
        { indexname: "products_sku_accent_trgm_idx" },
      ]);
    } finally {
      await chainDatabase.close();
    }
  });
});

describe("transactional concurrent-index SQL lexer", () => {
  test("rewrites every real 0090/0091 top-level CREATE and DROP exactly", () => {
    const cases = [
      ["0090_product_accent_search_indexes.sql", 3],
      ["0091_fix_product_accent_search_indexes.sql", 6],
    ];
    for (const [fileName, expectedCount] of cases) {
      const statements = splitMigrationStatements(
        readFileSync(`${projectRoot}/drizzle/${fileName}`, "utf8"),
      ).filter((statement) => /\b(?:create|drop)\s+index\s+concurrently\b/i.test(statement));
      expect(statements).toHaveLength(expectedCount);
      for (const statement of statements) {
        const expected = statement
          .replace("INDEX CONCURRENTLY ", "INDEX ");
        expect(transactionalizeMigrationStatement(statement)).toBe(expected);
      }
    }
  });

  test("preserves comments, quoted data, identifiers, escape strings, and dollar bodies byte-for-byte", () => {
    const protectedSql = `-- CREATE UNIQUE INDEX CONCURRENTLY comment_idx ON hidden(id)
/* DROP INDEX CONCURRENTLY block_comment_idx */
SELECT
  'CREATE INDEX CONCURRENTLY single_quote_idx',
  E'DROP INDEX CONCURRENTLY escape\\'d_idx',
  "CREATE INDEX CONCURRENTLY quoted identifier",
  $$CREATE INDEX CONCURRENTLY dollar_body_idx$$,
  $migration$DROP INDEX CONCURRENTLY tagged_body_idx$migration$;
DO $body$
BEGIN
  PERFORM 'CREATE INDEX CONCURRENTLY nested_body_idx';
END
$body$;`;
    expect(transactionalizeMigrationStatement(protectedSql)).toBe(protectedSql);
  });

  test("rejects unsupported top-level CONCURRENTLY grammar without mutating it", () => {
    const unsupported = [
      "REINDEX INDEX CONCURRENTLY unsupported_idx;",
      "CREATE INDEX IF NOT EXISTS unsupported_idx ON products(id) CONCURRENTLY;",
      "DROP INDEX IF EXISTS unsupported_idx CONCURRENTLY;",
      "REFRESH MATERIALIZED VIEW CONCURRENTLY unsupported_view;",
    ];
    for (const statement of unsupported) {
      expect(() => transactionalizeMigrationStatement(statement))
        .toThrow(/unsupported top-level concurrently/i);
    }
  });
});

describe("production migration run serialization", () => {
  test("two runners serialize before tracking and the waiter rechecks after acquiring the lock", async () => {
    const effectStarted = deferred();
    const releaseEffect = deferred();
    const shared = {
      lock: new AdvisoryLockHarness(),
      tracked: new Set(),
      events: [],
      effectCount: 0,
    };
    const migrations = [{ name: "once.sql", content: "select apply_once()" }];
    const first = runMigrationChain(
      createRunConnection("runner-a", shared, {
        onEffectStart: effectStarted.resolve,
        effectGate: releaseEffect.promise,
      }),
      migrations,
      {
        sleep: async () => {},
        afterLockAcquired: async () => shared.events.push("runner-a:session-config"),
      },
    );
    await effectStarted.promise;
    const second = runMigrationChain(
      createRunConnection("runner-b", shared),
      migrations,
      { sleep: async () => {} },
    );
    await Promise.resolve();

    expect(shared.events).not.toContain("runner-b:create table if");
    expect(shared.events).not.toContain("runner-b:select name from");
    releaseEffect.resolve();

    expect(await first).toEqual({ applied: ["once.sql"], skipped: [] });
    expect(await second).toEqual({ applied: [], skipped: ["once.sql"] });
    expect(shared.effectCount).toBe(1);
    expect(shared.events.indexOf("runner-b:lock-acquired"))
      .toBeGreaterThan(shared.events.indexOf("runner-a:lock-released"));
    expect(shared.events.indexOf("runner-b:select name from"))
      .toBeGreaterThan(shared.events.indexOf("runner-b:lock-acquired"));
    expect(shared.events.indexOf("runner-a:session-config"))
      .toBeGreaterThan(shared.events.indexOf("runner-a:lock-acquired"));
    expect(shared.events.indexOf("runner-a:create table if"))
      .toBeGreaterThan(shared.events.indexOf("runner-a:session-config"));
  });

  test("application-first and runner-first database lock orderings serialize migration work", async () => {
    const shared = {
      lock: new AdvisoryLockHarness(),
      databaseLock: new DatabaseLockHarness(),
      tracked: new Set(),
      events: [],
      effectCount: 0,
    };
    await shared.databaseLock.acquire("application");
    const effectAttempted = deferred();
    const runnerAfterApplication = runMigrationChain(
      createRunConnection("runner-after-app", shared, {
        onEffectAttempt: effectAttempted.resolve,
      }),
      [{ name: "app-first.sql", content: "select apply_once()" }],
      { sleep: async () => {} },
    );
    await effectAttempted.promise;
    expect(shared.effectCount).toBe(0);
    expect(shared.events).toContain("runner-after-app:select apply_once()");
    shared.databaseLock.release("application");
    await runnerAfterApplication;

    const effectStarted = deferred();
    const releaseEffect = deferred();
    const runnerFirst = runMigrationChain(
      createRunConnection("runner-first", shared, {
        onEffectStart: effectStarted.resolve,
        effectGate: releaseEffect.promise,
      }),
      [{ name: "runner-first.sql", content: "select apply_once()" }],
      { sleep: async () => {} },
    );
    await effectStarted.promise;
    let applicationAcquired = false;
    const application = shared.databaseLock.acquire("application")
      .then(() => { applicationAcquired = true; });
    await Promise.resolve();
    expect(applicationAcquired).toBe(false);
    releaseEffect.resolve();
    await runnerFirst;
    await application;
    expect(applicationAcquired).toBe(true);
    shared.databaseLock.release("application");
  });

  test("40P01 retries the whole file transaction before tracking it", async () => {
    const shared = {
      lock: new AdvisoryLockHarness(),
      tracked: new Set(),
      events: [],
      effectCount: 0,
    };
    await expect(runMigrationChain(
      createRunConnection("deadlock-runner", shared, { deadlockOnce: true }),
      [{ name: "deadlock.sql", content: "select apply_once()" }],
      { sleep: async () => {} },
    )).resolves.toEqual({ applied: ["deadlock.sql"], skipped: [] });
    expect(shared.events.filter((event) => event === "deadlock-runner:begin")).toHaveLength(2);
    expect(shared.effectCount).toBe(1);
    expect([...shared.tracked]).toEqual(["deadlock.sql"]);
  });
});
