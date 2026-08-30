const ALREADY_EXISTS = new Set([
  "42P07", // duplicate_table (table/index)
  "42710", // duplicate_object (type, enum value, constraint)
  "42701", // duplicate_column
]);

export interface MigrationConnection {
  unsafe(statement: string, parameters?: readonly unknown[]): Promise<unknown>;
}

export interface MigrationFileResult {
  statementCount: number;
  skippedCount: number;
}

export function splitMigrationStatements(content: string): string[] {
  return content
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * `CREATE/DROP INDEX CONCURRENTLY` cannot run inside a transaction. Historical
 * migrations used it to reduce rollout locks, but an untracked replay must keep
 * the file atomic. On replay we deliberately use the transactional form; an
 * already-tracked production migration is never re-executed.
 */
export function transactionalizeMigrationStatement(statement: string): string {
  return statement
    .replace(/\bCREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/gi, "CREATE $1INDEX")
    .replace(/\bDROP\s+INDEX\s+CONCURRENTLY\b/gi, "DROP INDEX");
}

export async function applyMigrationFileAtomically(
  connection: MigrationConnection,
  fileName: string,
  content: string,
): Promise<MigrationFileResult> {
  const statements = splitMigrationStatements(content);
  let skippedCount = 0;

  await connection.unsafe("begin");
  try {
    for (const [index, rawStatement] of statements.entries()) {
      const savepoint = `migration_statement_${index}`;
      await connection.unsafe(`savepoint ${savepoint}`);
      try {
        await connection.unsafe(transactionalizeMigrationStatement(rawStatement));
        await connection.unsafe(`release savepoint ${savepoint}`);
      } catch (error) {
        await connection.unsafe(`rollback to savepoint ${savepoint}`);
        await connection.unsafe(`release savepoint ${savepoint}`);
        const code = (error as { code?: string }).code;
        if (code && ALREADY_EXISTS.has(code)) {
          skippedCount++;
          continue;
        }
        throw error;
      }
    }

    await connection.unsafe(
      "insert into _migrations (name) values ($1) on conflict do nothing",
      [fileName],
    );
    await connection.unsafe("commit");
    return { statementCount: statements.length, skippedCount };
  } catch (error) {
    try {
      await connection.unsafe("rollback");
    } catch {
      // Preserve the migration error; a dropped connection is already rolled back.
    }
    throw error;
  }
}
