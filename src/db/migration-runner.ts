export interface MigrationConnection {
  unsafe(statement: string, parameters?: readonly unknown[]): Promise<unknown>;
}

export const MIGRATION_ADVISORY_LOCK_KEY = 1_280_657_217;

const RETRYABLE_FILE_ERRORS = new Set([
  "40P01", // deadlock_detected
  "55P03", // lock_not_available
  "57014", // query_canceled / statement timeout
]);

export type MigrationFileResult =
  | { status: "applied"; statementCount: number }
  | { status: "already-applied"; statementCount: 0 };

export interface MigrationSource {
  name: string;
  content: string;
}

export interface MigrationRunResult {
  applied: string[];
  skipped: string[];
}

export interface MigrationRunOptions {
  maxFileRetries?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  afterLockAcquired?: () => Promise<void>;
  onFileStart?: (fileName: string) => void;
  onFileRetry?: (fileName: string, code: string, attempt: number, maximum: number) => void;
}

export function splitMigrationStatements(content: string): string[] {
  return content
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

interface SqlToken {
  value: string;
  start: number;
  end: number;
}

const isIdentifierStart = (character: string) => /[A-Za-z_]/.test(character);
const isIdentifierPart = (character: string) => /[A-Za-z0-9_$]/.test(character);

function topLevelSqlCommands(statement: string): SqlToken[][] {
  const commands: SqlToken[][] = [[]];
  let command = commands[0];
  let depth = 0;
  let index = 0;

  while (index < statement.length) {
    const character = statement[index];
    const next = statement[index + 1];

    if (/\s/.test(character)) {
      index++;
      continue;
    }
    if (character === "-" && next === "-") {
      const lineEnd = statement.indexOf("\n", index + 2);
      index = lineEnd === -1 ? statement.length : lineEnd + 1;
      continue;
    }
    if (character === "/" && next === "*") {
      let commentDepth = 1;
      index += 2;
      while (index < statement.length && commentDepth > 0) {
        if (statement[index] === "/" && statement[index + 1] === "*") {
          commentDepth++;
          index += 2;
        } else if (statement[index] === "*" && statement[index + 1] === "/") {
          commentDepth--;
          index += 2;
        } else {
          index++;
        }
      }
      continue;
    }
    if (character === "'") {
      const prefix = statement[index - 1];
      const beforePrefix = statement[index - 2];
      const escapeString = (prefix === "E" || prefix === "e")
        && (index < 2 || !isIdentifierPart(beforePrefix));
      index++;
      while (index < statement.length) {
        if (escapeString && statement[index] === "\\") {
          index += 2;
        } else if (statement[index] === "'" && statement[index + 1] === "'") {
          index += 2;
        } else if (statement[index] === "'") {
          index++;
          break;
        } else {
          index++;
        }
      }
      continue;
    }
    if (character === '"') {
      index++;
      while (index < statement.length) {
        if (statement[index] === '"' && statement[index + 1] === '"') {
          index += 2;
        } else if (statement[index] === '"') {
          index++;
          break;
        } else {
          index++;
        }
      }
      continue;
    }
    if (character === "$") {
      const tag = statement.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) {
        const bodyEnd = statement.indexOf(tag, index + tag.length);
        index = bodyEnd === -1 ? statement.length : bodyEnd + tag.length;
        continue;
      }
    }
    if (character === "(") {
      depth++;
      index++;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      index++;
      continue;
    }
    if (character === ";" && depth === 0) {
      command = [];
      commands.push(command);
      index++;
      continue;
    }
    if (isIdentifierStart(character)) {
      const start = index;
      index++;
      while (index < statement.length && isIdentifierPart(statement[index])) index++;
      if (depth === 0) {
        command.push({
          value: statement.slice(start, index).toUpperCase(),
          start,
          end: index,
        });
      }
      continue;
    }
    index++;
  }

  return commands;
}

/**
 * `CREATE/DROP INDEX CONCURRENTLY` cannot run inside a transaction. Historical
 * migrations used it to reduce rollout locks, but an untracked replay must keep
 * the file atomic. Only a lexically validated top-level command is transformed;
 * quoted data, identifiers, comments, nested expressions, and dollar bodies are
 * never rewritten. Unknown top-level forms fail instead of changing checked-in SQL.
 */
export function transactionalizeMigrationStatement(statement: string): string {
  const removals: Array<{ start: number; end: number }> = [];

  for (const tokens of topLevelSqlCommands(statement)) {
    const concurrentTokens = tokens.filter((token) => token.value === "CONCURRENTLY");
    if (concurrentTokens.length === 0) continue;

    let concurrentIndex = -1;
    if (tokens[0]?.value === "CREATE") {
      const indexKeyword = tokens[1]?.value === "UNIQUE" ? 2 : 1;
      if (tokens[indexKeyword]?.value === "INDEX"
        && tokens[indexKeyword + 1]?.value === "CONCURRENTLY") {
        concurrentIndex = indexKeyword + 1;
      }
    } else if (tokens[0]?.value === "DROP"
      && tokens[1]?.value === "INDEX"
      && tokens[2]?.value === "CONCURRENTLY") {
      concurrentIndex = 2;
    }

    if (concurrentIndex === -1 || concurrentTokens.length !== 1) {
      throw new Error(
        "Unsupported top-level CONCURRENTLY form; expected CREATE [UNIQUE] INDEX CONCURRENTLY or DROP INDEX CONCURRENTLY",
      );
    }
    const token = tokens[concurrentIndex];
    const removeTrailingSpace = statement[token.end] === " " ? 1 : 0;
    removals.push({ start: token.start, end: token.end + removeTrailingSpace });
  }

  let transformed = statement;
  for (const removal of removals.reverse()) {
    transformed = transformed.slice(0, removal.start) + transformed.slice(removal.end);
  }
  return transformed;
}

export async function applyMigrationFileAtomically(
  connection: MigrationConnection,
  fileName: string,
  content: string,
): Promise<MigrationFileResult> {
  const statements = splitMigrationStatements(content);
  let statementNumber = 0;

  await connection.unsafe("begin");
  try {
    const tracked = await connection.unsafe(
      "select name from _migrations where name = $1",
      [fileName],
    ) as unknown[];
    if (tracked.length > 0) {
      await connection.unsafe("commit");
      return { status: "already-applied", statementCount: 0 };
    }

    for (const [index, rawStatement] of statements.entries()) {
      statementNumber = index + 1;
      await connection.unsafe(transactionalizeMigrationStatement(rawStatement));
    }

    await connection.unsafe(
      "insert into _migrations (name) values ($1)",
      [fileName],
    );
    await connection.unsafe("commit");
    return { status: "applied", statementCount: statements.length };
  } catch (error) {
    try {
      await connection.unsafe("rollback");
    } catch {
      // Preserve the migration error; a dropped connection is already rolled back.
    }
    const phase = statementNumber > 0
      ? `statement ${statementNumber}`
      : "preflight/tracking";
    const wrapped = new Error(
      `Migration ${fileName} failed at ${phase}; transaction rolled back and the migration remains untracked`,
      { cause: error },
    ) as Error & { code?: string };
    wrapped.code = (error as { code?: string }).code;
    throw wrapped;
  }
}

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

export async function runMigrationChain(
  connection: MigrationConnection,
  migrations: readonly MigrationSource[],
  options: MigrationRunOptions = {},
): Promise<MigrationRunResult> {
  const applied: string[] = [];
  const skipped: string[] = [];
  const maximumRetries = options.maxFileRetries ?? 5;
  const sleep = options.sleep ?? defaultSleep;
  let lockHeld = false;

  try {
    await connection.unsafe(
      "select pg_advisory_lock($1)",
      [MIGRATION_ADVISORY_LOCK_KEY],
    );
    lockHeld = true;
    await options.afterLockAcquired?.();

    await connection.unsafe(`create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`);
    const trackedRows = await connection.unsafe(
      "select name from _migrations where name <> $1",
      [""],
    ) as Array<{ name: string }>;
    const tracked = new Set(trackedRows.map((row) => row.name));

    for (const migration of migrations) {
      if (tracked.has(migration.name)) {
        skipped.push(migration.name);
        continue;
      }
      options.onFileStart?.(migration.name);

      let retryCount = 0;
      for (;;) {
        try {
          const result = await applyMigrationFileAtomically(
            connection,
            migration.name,
            migration.content,
          );
          if (result.status === "already-applied") {
            skipped.push(migration.name);
          } else {
            applied.push(migration.name);
          }
          tracked.add(migration.name);
          break;
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (!code || !RETRYABLE_FILE_ERRORS.has(code) || retryCount >= maximumRetries) {
            throw error;
          }
          retryCount++;
          options.onFileRetry?.(
            migration.name,
            code,
            retryCount,
            maximumRetries,
          );
          await sleep(2_000 * retryCount);
        }
      }
    }

    return { applied, skipped };
  } finally {
    if (lockHeld) {
      await connection.unsafe(
        "select pg_advisory_unlock($1)",
        [MIGRATION_ADVISORY_LOCK_KEY],
      );
    }
  }
}
