export interface MigrationConnection {
  unsafe(statement: string, parameters?: readonly unknown[]): Promise<unknown>;
}

export interface ReservedMigrationConnection extends MigrationConnection {
  release(): void | Promise<void>;
}

export interface MigrationConnectionPool {
  reserve(): Promise<ReservedMigrationConnection>;
  end?(): Promise<void>;
}

export const MIGRATION_ADVISORY_LOCK_KEY = 1_280_657_217;

export type MigrationPhase =
  | "reserve"
  | "lock"
  | "session-verify"
  | "configure"
  | "tracking-create"
  | "tracking-read"
  | "begin"
  | "statement"
  | "tracking-insert"
  | "commit"
  | "rollback"
  | "unlock"
  | "release";

export type MigrationOperationalError = Error & {
  phase?: MigrationPhase;
  code?: string;
  fileName?: string;
  statementNumber?: number;
  outcomeUnknown?: boolean;
  expectedBackendPid?: number;
  observedBackendPid?: number;
  secondaryErrors?: MigrationOperationalError[];
};

const TRANSACTION_POOLER_PORT = "6543";

/**
 * Migrations require a dedicated direct/session connection. The application URL
 * is intentionally never used as a fallback because production commonly uses
 * a transaction pooler that cannot preserve session advisory-lock ownership.
 */
export function readMigrationDatabaseUrl(
  environment: Record<string, string | undefined>,
): string {
  const value = environment.MIGRATION_DATABASE_URL?.trim();
  if (!value) {
    throw new Error(
      "MIGRATION_DATABASE_URL is required and must be separate from DATABASE_URL",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("MIGRATION_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("MIGRATION_DATABASE_URL must use the postgres or postgresql protocol");
  }

  const hasTransactionModeHint = [...parsed.searchParams.entries()].some(([rawKey, rawValue]) => {
    const key = rawKey.toLowerCase();
    const parameterValue = rawValue.toLowerCase();
    if ((key === "pool_mode" || key === "poolmode" || key === "mode")
      && parameterValue === "transaction") {
      return true;
    }
    if (key === "pgbouncer"
      && (parameterValue === "" || ["1", "true", "yes", "transaction"].includes(parameterValue))) {
      return true;
    }
    return /\b(?:pool_mode|poolmode|mode)\s*=\s*transaction\b/i.test(rawValue)
      || /\bpgbouncer\s*=\s*(?:1|true|yes|transaction)\b/i.test(rawValue);
  });

  if (parsed.port === TRANSACTION_POOLER_PORT || hasTransactionModeHint) {
    throw new Error(
      "MIGRATION_DATABASE_URL must use a direct or session PostgreSQL endpoint "
      + "(Supabase: port 5432); transaction/pgbouncer pooling is unsupported",
    );
  }
  return value;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function errorCode(error: unknown): string | undefined {
  return typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : undefined;
}

function createPhaseError(
  phase: MigrationPhase,
  cause: unknown,
  options: {
    fileName?: string;
    statementNumber?: number;
    outcomeUnknown?: boolean;
    boundary?: string;
    expectedBackendPid?: number;
    observedBackendPid?: number;
  } = {},
): MigrationOperationalError {
  const filePrefix = options.fileName
    ? `Migration ${options.fileName} failed at ${phase === "statement"
      ? `statement ${options.statementNumber ?? "unknown"}`
      : phase}`
    : `Migration runner failed at ${phase}${options.boundary ? ` (${options.boundary})` : ""}`;
  const message = options.outcomeUnknown
    ? `${filePrefix}; outcome unknown because the commit acknowledgement was lost. `
      + "Do not assume rollback; rerun the migration runner for a locked tracking recheck"
    : filePrefix;
  const wrapped = new Error(message, { cause: asError(cause) }) as MigrationOperationalError;
  wrapped.name = "MigrationRunnerError";
  wrapped.phase = phase;
  wrapped.code = errorCode(cause);
  wrapped.fileName = options.fileName;
  wrapped.statementNumber = options.statementNumber;
  wrapped.outcomeUnknown = options.outcomeUnknown;
  wrapped.expectedBackendPid = options.expectedBackendPid;
  wrapped.observedBackendPid = options.observedBackendPid;
  return wrapped;
}

function combineErrors(
  primary: unknown,
  additional: readonly MigrationOperationalError[],
): MigrationOperationalError {
  const primaryError = asError(primary) as MigrationOperationalError;
  if (additional.length === 0) return primaryError;

  const aggregate = new AggregateError(
    [primaryError, ...additional],
    primaryError.message,
    { cause: primaryError },
  ) as AggregateError & MigrationOperationalError;
  aggregate.phase = primaryError.phase;
  aggregate.code = primaryError.code;
  aggregate.fileName = primaryError.fileName;
  aggregate.statementNumber = primaryError.statementNumber;
  aggregate.outcomeUnknown = primaryError.outcomeUnknown;
  aggregate.expectedBackendPid = primaryError.expectedBackendPid;
  aggregate.observedBackendPid = primaryError.observedBackendPid;
  aggregate.secondaryErrors = [
    ...(primaryError.secondaryErrors ?? []),
    ...additional,
  ];
  return aggregate;
}

function isConnectionLoss(error: unknown): boolean {
  const code = errorCode(error);
  if (code?.startsWith("08")) return true;
  const cause = asError(error) as Error & { code?: string };
  return [
    "57P01", // admin_shutdown
    "57P02", // crash_shutdown
    "57P03", // cannot_connect_now
    "CONNECTION_CLOSED",
    "CONNECTION_DESTROYED",
    "ECONNRESET",
    "EPIPE",
    "ETIMEDOUT",
  ].includes(cause.code ?? "")
    || /(?:connection.*(?:closed|lost|terminated|reset|destroyed)|terminating connection|socket hang up)/i
      .test(cause.message);
}

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
  afterLockAcquired?: (connection: MigrationConnection) => Promise<void>;
  onFileStart?: (fileName: string) => void;
  onFileRetry?: (fileName: string, code: string, attempt: number, maximum: number) => void;
}

interface SqlToken {
  value: string;
  start: number;
  end: number;
}

interface SqlScannerHandlers {
  onTopLevelToken?: (token: SqlToken) => void;
  onTopLevelSemicolon?: (start: number, end: number) => void;
  onTopLevelBreakpoint?: (start: number, end: number) => void;
}

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

const isHighIdentifierCharacter = (character: string | undefined) => (
  character !== undefined && character.charCodeAt(0) >= 0x80
);
const isIdentifierStart = (character: string | undefined) => (
  character !== undefined
  && (/[A-Za-z_]/.test(character) || isHighIdentifierCharacter(character))
);
const isIdentifierPart = (character: string | undefined) => (
  character !== undefined
  && (/[A-Za-z0-9_$]/.test(character) || isHighIdentifierCharacter(character))
);
const isDollarTagPart = (character: string | undefined) => (
  character !== undefined
  && (/[A-Za-z0-9_]/.test(character) || isHighIdentifierCharacter(character))
);

function dollarQuoteTagAt(statement: string, start: number): string | undefined {
  if (statement[start] !== "$") return undefined;
  if (statement[start + 1] === "$") return "$$";
  if (!isIdentifierStart(statement[start + 1])) return undefined;

  let index = start + 2;
  while (isDollarTagPart(statement[index])) index++;
  return statement[index] === "$" ? statement.slice(start, index + 1) : undefined;
}

function skipSingleQuotedString(statement: string, quoteStart: number): number {
  const prefix = statement[quoteStart - 1];
  const beforePrefix = statement[quoteStart - 2];
  const escapeString = (prefix === "E" || prefix === "e")
    && !isIdentifierPart(beforePrefix);
  let index = quoteStart + 1;
  while (index < statement.length) {
    if (escapeString && statement[index] === "\\") {
      index = Math.min(statement.length, index + 2);
    } else if (statement[index] === "'" && statement[index + 1] === "'") {
      index += 2;
    } else if (statement[index] === "'") {
      return index + 1;
    } else {
      index++;
    }
  }
  return statement.length;
}

function skipDoubleQuotedIdentifier(statement: string, quoteStart: number): number {
  let index = quoteStart + 1;
  while (index < statement.length) {
    if (statement[index] === '"' && statement[index + 1] === '"') {
      index += 2;
    } else if (statement[index] === '"') {
      return index + 1;
    } else {
      index++;
    }
  }
  return statement.length;
}

function scanSql(statement: string, handlers: SqlScannerHandlers): void {
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
      const commentEnd = lineEnd === -1 ? statement.length : lineEnd;
      const comment = statement.slice(index, commentEnd).trimEnd();
      const end = lineEnd === -1 ? statement.length : lineEnd + 1;
      if (depth === 0 && comment === STATEMENT_BREAKPOINT) {
        handlers.onTopLevelBreakpoint?.(index, end);
      }
      index = end;
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
      index = skipSingleQuotedString(statement, index);
      continue;
    }
    if (character === '"') {
      index = skipDoubleQuotedIdentifier(statement, index);
      continue;
    }
    if (character === "$") {
      const tag = dollarQuoteTagAt(statement, index);
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
      handlers.onTopLevelSemicolon?.(index, index + 1);
      index++;
      continue;
    }
    if (isIdentifierStart(character)) {
      const start = index;
      index++;
      while (isIdentifierPart(statement[index])) index++;
      if (depth === 0) {
        handlers.onTopLevelToken?.({
          value: statement.slice(start, index).toUpperCase(),
          start,
          end: index,
        });
      }
      continue;
    }
    index++;
  }
}

export function splitMigrationStatements(content: string): string[] {
  const statements: string[] = [];
  let statementStart = 0;
  const pushStatement = (end: number) => {
    const statement = content.slice(statementStart, end).trim();
    if (statement) statements.push(statement);
  };

  scanSql(content, {
    onTopLevelSemicolon: (_start, end) => {
      pushStatement(end);
      statementStart = end;
    },
    onTopLevelBreakpoint: (start, end) => {
      pushStatement(start);
      statementStart = end;
    },
  });
  pushStatement(content.length);
  return statements;
}

function topLevelSqlCommands(statement: string): SqlToken[][] {
  const commands: SqlToken[][] = [[]];
  let command = commands[0];
  const nextCommand = () => {
    if (command.length > 0) {
      command = [];
      commands.push(command);
    }
  };

  scanSql(statement, {
    onTopLevelToken: (token) => command.push(token),
    onTopLevelSemicolon: nextCommand,
    onTopLevelBreakpoint: nextCommand,
  });

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
  let phase: MigrationPhase = "begin";
  let statementNumber = 0;
  let transactionStarted = false;

  try {
    await connection.unsafe("begin");
    transactionStarted = true;

    phase = "tracking-read";
    const tracked = await connection.unsafe(
      "select name from _migrations where name = $1",
      [fileName],
    ) as unknown[];
    if (tracked.length > 0) {
      phase = "commit";
      await connection.unsafe("commit");
      transactionStarted = false;
      return { status: "already-applied", statementCount: 0 };
    }

    for (const [index, rawStatement] of statements.entries()) {
      phase = "statement";
      statementNumber = index + 1;
      await connection.unsafe(transactionalizeMigrationStatement(rawStatement));
    }

    phase = "tracking-insert";
    await connection.unsafe(
      "insert into _migrations (name) values ($1)",
      [fileName],
    );
    phase = "commit";
    await connection.unsafe("commit");
    transactionStarted = false;
    return { status: "applied", statementCount: statements.length };
  } catch (cause) {
    const outcomeUnknown = phase === "commit" && isConnectionLoss(cause);
    const primary = createPhaseError(phase, cause, {
      fileName,
      statementNumber: phase === "statement" ? statementNumber : undefined,
      outcomeUnknown,
    });
    const cleanupErrors: MigrationOperationalError[] = [];

    if (transactionStarted) {
      try {
        await connection.unsafe("rollback");
        if (!outcomeUnknown) {
          primary.message += "; transaction rolled back and the migration remains untracked";
        }
      } catch (rollbackCause) {
        cleanupErrors.push(createPhaseError("rollback", rollbackCause, { fileName }));
        if (!outcomeUnknown) {
          primary.message += "; rollback could not be confirmed. "
            + "Rerun the migration runner for a locked tracking recheck";
        }
      }
    }
    throw combineErrors(primary, cleanupErrors);
  }
}

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

async function runPhase<T>(
  phase: MigrationPhase,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    throw createPhaseError(phase, cause);
  }
}

async function readBackendPid(connection: MigrationConnection): Promise<number> {
  const rows = await connection.unsafe(
    "select pg_backend_pid() as backend_pid",
  ) as Array<{ backend_pid?: number | string }>;
  const value = Number(rows[0]?.backend_pid);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("pg_backend_pid() did not return a positive integer");
  }
  return value;
}

async function verifyBackendPid(
  connection: MigrationConnection,
  expectedBackendPid: number,
  boundary: string,
): Promise<void> {
  let observedBackendPid: number;
  try {
    observedBackendPid = await readBackendPid(connection);
  } catch (cause) {
    throw createPhaseError("session-verify", cause, {
      boundary,
      expectedBackendPid,
    });
  }
  if (observedBackendPid !== expectedBackendPid) {
    const cause = new Error(
      `PostgreSQL backend PID changed: expected ${expectedBackendPid}, observed ${observedBackendPid}`,
    );
    const error = createPhaseError("session-verify", cause, {
      boundary,
      expectedBackendPid,
      observedBackendPid,
    });
    error.message = `PostgreSQL backend PID changed during ${boundary}: `
      + `expected ${expectedBackendPid}, observed ${observedBackendPid}`;
    throw error;
  }
}

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
  let expectedBackendPid: number | undefined;
  let result: MigrationRunResult | undefined;
  let primaryError: MigrationOperationalError | undefined;

  try {
    await runPhase("lock", () => connection.unsafe(
      "select pg_advisory_lock($1)", [MIGRATION_ADVISORY_LOCK_KEY],
    ));
    lockHeld = true;
    try {
      expectedBackendPid = await readBackendPid(connection);
    } catch (cause) {
      throw createPhaseError("session-verify", cause, {
        boundary: "after advisory acquisition",
      });
    }

    await verifyBackendPid(connection, expectedBackendPid, "before configure");
    if (options.afterLockAcquired) {
      await runPhase(
        "configure",
        () => options.afterLockAcquired!(connection),
      );
    }
    await verifyBackendPid(connection, expectedBackendPid, "after configure");

    await verifyBackendPid(connection, expectedBackendPid, "before tracking-create");
    await runPhase("tracking-create", () => connection.unsafe(`create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`));
    await verifyBackendPid(connection, expectedBackendPid, "after tracking-create");

    await verifyBackendPid(connection, expectedBackendPid, "before tracking-read");
    const trackedRows = await runPhase("tracking-read", () => connection.unsafe(
      "select name from _migrations where name <> $1",
      [""],
    )) as Array<{ name: string }>;
    await verifyBackendPid(connection, expectedBackendPid, "after tracking-read");
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
          await verifyBackendPid(
            connection,
            expectedBackendPid,
            `before file ${migration.name}`,
          );
          const fileResult = await applyMigrationFileAtomically(
            connection,
            migration.name,
            migration.content,
          );
          await verifyBackendPid(
            connection,
            expectedBackendPid,
            `after file ${migration.name}`,
          );
          if (fileResult.status === "already-applied") {
            skipped.push(migration.name);
          } else {
            applied.push(migration.name);
          }
          tracked.add(migration.name);
          break;
        } catch (error) {
          const code = errorCode(error);
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

    result = { applied, skipped };
  } catch (error) {
    primaryError = asError(error) as MigrationOperationalError;
  }

  const unlockErrors: MigrationOperationalError[] = [];
  if (lockHeld) {
    if (expectedBackendPid !== undefined) {
      try {
        await verifyBackendPid(connection, expectedBackendPid, "before unlock");
      } catch (error) {
        unlockErrors.push(asError(error) as MigrationOperationalError);
      }
    }

    try {
      const unlockRows = await connection.unsafe(
        "select pg_advisory_unlock($1)",
        [MIGRATION_ADVISORY_LOCK_KEY],
      ) as Array<{ pg_advisory_unlock?: boolean }>;
      if (unlockRows[0]?.pg_advisory_unlock !== true) {
        throw new Error("PostgreSQL advisory unlock returned false; lock was not owned by this session");
      }
    } catch (cause) {
      const unlockError = createPhaseError("unlock", cause);
      if (/advisory unlock returned false/i.test(asError(cause).message)) {
        unlockError.message = "Migration runner failed at unlock: "
          + "PostgreSQL advisory lock was not owned by this session (unlock returned false)";
      }
      unlockErrors.push(unlockError);
    }

    if (expectedBackendPid !== undefined) {
      try {
        await verifyBackendPid(connection, expectedBackendPid, "after unlock");
      } catch (error) {
        unlockErrors.push(asError(error) as MigrationOperationalError);
      }
    }
  }

  if (primaryError) throw combineErrors(primaryError, unlockErrors);
  if (unlockErrors.length > 0) {
    throw combineErrors(unlockErrors[0], unlockErrors.slice(1));
  }
  return result ?? { applied, skipped };
}

export async function runMigrationChainWithReservedConnection(
  pool: MigrationConnectionPool,
  migrations: readonly MigrationSource[],
  options: MigrationRunOptions = {},
): Promise<MigrationRunResult> {
  let connection: ReservedMigrationConnection | undefined;
  let result: MigrationRunResult | undefined;
  let primaryError: MigrationOperationalError | undefined;

  try {
    connection = await pool.reserve();
    result = await runMigrationChain(connection, migrations, options);
  } catch (error) {
    primaryError = connection
      ? asError(error) as MigrationOperationalError
      : createPhaseError("reserve", error);
  }

  const releaseErrors: MigrationOperationalError[] = [];
  if (connection) {
    try {
      await connection.release();
    } catch (cause) {
      releaseErrors.push(createPhaseError("release", cause, {
        boundary: "reserved connection",
      }));
    }
  }
  if (pool.end) {
    try {
      await pool.end();
    } catch (cause) {
      releaseErrors.push(createPhaseError("release", cause, {
        boundary: "connection pool",
      }));
    }
  }

  if (primaryError) throw combineErrors(primaryError, releaseErrors);
  if (releaseErrors.length > 0) {
    throw combineErrors(releaseErrors[0], releaseErrors.slice(1));
  }
  return result ?? { applied: [], skipped: [] };
}
