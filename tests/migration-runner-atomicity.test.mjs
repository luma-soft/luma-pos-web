import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const {
  applyMigrationFileAtomically,
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

afterAll(async () => database.close());

describe("production migration runner file atomicity", () => {
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
        create table _migrations (
          name text primary key,
          applied_at timestamptz not null default now()
        );
      `);
      const migrationFiles = readdirSync(`${projectRoot}/drizzle`)
        .filter((name) => name.endsWith(".sql"))
        .sort();
      for (const file of migrationFiles) {
        const statements = splitMigrationStatements(
          readFileSync(`${projectRoot}/drizzle/${file}`, "utf8"),
        ).filter((statement) => !/create extension|gin_trgm_ops/i.test(statement));
        const transactionalContent = statements
          .map(transactionalizeMigrationStatement)
          .join("\n--> statement-breakpoint\n");
        expect(transactionalContent).not.toMatch(
          /\b(?:create|drop)\s+(?:unique\s+)?index\s+concurrently\b/i,
        );
        await applyMigrationFileAtomically(chainConnection, file, transactionalContent);
      }
      expect((await chainDatabase.query(`select count(*)::int count from _migrations`)).rows)
        .toEqual([{ count: migrationFiles.length }]);
    } finally {
      await chainDatabase.close();
    }
  });
});
