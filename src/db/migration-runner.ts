import postgres from "postgres";

export interface MigrationConnection {
  unsafe(statement: string, parameters?: readonly unknown[]): Promise<unknown>;
}

export interface ReservedMigrationConnection extends MigrationConnection {
  release(): void | Promise<void>;
}

export interface MigrationConnectionPool {
  reserve(): Promise<ReservedMigrationConnection>;
  end?(options?: { timeout?: number }): Promise<void>;
}

export const MIGRATION_ADVISORY_LOCK_KEY = 1_280_657_217;
export const MIGRATION_POOL_END_TIMEOUT_SECONDS = 5;

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
const FALSE_POOL_HINT_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

export interface MigrationDatabaseConfig {
  connectionString: string;
  hostname: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("MIGRATION_DATABASE_URL must be a valid PostgreSQL URL");
  }
}

function repeatedlyDecodeUrlComponent(value: string): string {
  let decoded = value;
  for (let attempt = 0; attempt < 3; attempt++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return decoded;
    }
    if (next === decoded) return decoded;
    decoded = next;
  }
  return decoded;
}

function normalizedPoolHintKey(value: string): string {
  return repeatedlyDecodeUrlComponent(value).toLowerCase().replaceAll("_", "").replaceAll("-", "");
}

function hasUnsupportedPoolHint(parsed: URL): boolean {
  const postgresOptionWhitespace = "[\\x09-\\x0d ]*";
  const poolModePattern = new RegExp(
    `(?:pool[_-]?mode|poolmode|mode)${postgresOptionWhitespace}=${postgresOptionWhitespace}`
      + "(?:transaction|statement)(?:[^A-Za-z0-9_]|$)",
    "i",
  );
  const pgbouncerPattern = new RegExp(
    `(?:pg[_-]?bouncer|pgbouncer)${postgresOptionWhitespace}=${postgresOptionWhitespace}`
      + "([^&;,\\x09-\\x0d ]*)",
    "i",
  );

  for (const [rawKey, rawValue] of parsed.searchParams.entries()) {
    const key = normalizedPoolHintKey(rawKey);
    const value = repeatedlyDecodeUrlComponent(rawValue).trim().toLowerCase();
    if ((key === "poolmode" || key === "mode")
      && (value === "transaction" || value === "statement")) {
      return true;
    }
    if (key === "pgbouncer" && !FALSE_POOL_HINT_VALUES.has(value)) {
      return true;
    }

    const candidates = [
      repeatedlyDecodeUrlComponent(rawKey),
      repeatedlyDecodeUrlComponent(rawValue),
      repeatedlyDecodeUrlComponent(`${rawKey}=${rawValue}`),
    ];
    for (const candidate of candidates) {
      if (poolModePattern.test(candidate)) return true;
      const pgbouncerMatch = candidate.match(pgbouncerPattern);
      if (pgbouncerMatch
        && !FALSE_POOL_HINT_VALUES.has(pgbouncerMatch[1].trim().toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Migrations require a dedicated direct/session connection. The application URL
 * is intentionally never used as a fallback because production commonly uses
 * a transaction pooler that cannot preserve session advisory-lock ownership.
 */
export function readMigrationDatabaseUrl(
  environment: Record<string, string | undefined>,
): MigrationDatabaseConfig {
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

  const username = decodeUrlComponent(parsed.username);
  const password = decodeUrlComponent(parsed.password);
  const hostname = parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
    ? parsed.hostname.slice(1, -1)
    : parsed.hostname;
  const database = parsed.pathname.slice(1);
  const port = Number(parsed.port);
  if (!hostname || !parsed.port || !Number.isSafeInteger(port) || port <= 0
    || !database || !username) {
    throw new Error(
      "MIGRATION_DATABASE_URL must be complete and explicit "
      + "(hostname, port, database path, and username)",
    );
  }

  if (parsed.port === TRANSACTION_POOLER_PORT || hasUnsupportedPoolHint(parsed)) {
    throw new Error(
      "MIGRATION_DATABASE_URL must use a direct or session PostgreSQL endpoint "
      + "(Supabase: port 5432); transaction/statement/pgbouncer pooling is unsupported",
    );
  }
  return {
    connectionString: value,
    hostname,
    port,
    database,
    username,
    password,
  };
}

export function createMigrationPostgresClient(
  config: MigrationDatabaseConfig,
  options: { maxConnections?: number } = {},
) {
  const maxConnections = options.maxConnections ?? 1;
  if (!Number.isSafeInteger(maxConnections) || maxConnections <= 0) {
    throw new Error("Migration PostgreSQL client maxConnections must be a positive integer");
  }

  const sql = postgres(config.connectionString, {
    // postgres-js supports arrays internally for exact multi-host pairing. An
    // array also prevents its string host parser from splitting an IPv6 colon.
    host: [config.hostname] as unknown as string,
    port: [config.port] as unknown as number,
    database: config.database,
    user: config.username,
    password: () => config.password,
    max: maxConnections,
    prepare: false,
    max_lifetime: null,
  });
  const effectiveHost = sql.options.host;
  const effectivePort = sql.options.port;
  const endpointMatches = Array.isArray(effectiveHost)
    && effectiveHost.length === 1
    && effectiveHost[0] === config.hostname
    && Array.isArray(effectivePort)
    && effectivePort.length === 1
    && effectivePort[0] === config.port
    && sql.options.database === config.database
    && sql.options.user === config.username;
  if (!endpointMatches || sql.options.max_lifetime !== null) {
    throw new Error(
      "Migration PostgreSQL client options do not match the validated dedicated configuration",
    );
  }
  return sql;
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
  poolEndTimeoutSeconds?: number;
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
const isPostgresWhitespace = (character: string | undefined) => (
  character === " "
  || character === "\t"
  || character === "\n"
  || character === "\r"
  || character === "\f"
  || character === "\v"
);

function trimPostgresWhitespace(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isPostgresWhitespace(value[start])) start++;
  while (end > start && isPostgresWhitespace(value[end - 1])) end--;
  return value.slice(start, end);
}

function trimPostgresWhitespaceEnd(value: string): string {
  let end = value.length;
  while (end > 0 && isPostgresWhitespace(value[end - 1])) end--;
  return value.slice(0, end);
}

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

    if (isPostgresWhitespace(character)) {
      index++;
      continue;
    }
    if (character === "-" && next === "-") {
      const lineEnd = statement.indexOf("\n", index + 2);
      const commentEnd = lineEnd === -1 ? statement.length : lineEnd;
      const comment = trimPostgresWhitespaceEnd(statement.slice(index, commentEnd));
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
    const statement = trimPostgresWhitespace(content.slice(statementStart, end));
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
  expectedBackendPid?: number,
): Promise<MigrationFileResult> {
  const statements = splitMigrationStatements(content);
  let phase: MigrationPhase = "begin";
  let statementNumber = 0;
  let transactionStarted = false;
  const verifyFileBackendPid = async (boundary: string) => {
    if (expectedBackendPid === undefined) return;
    phase = "session-verify";
    await verifyBackendPid(connection, expectedBackendPid, boundary, fileName);
  };

  try {
    await connection.unsafe("begin");
    transactionStarted = true;
    await verifyFileBackendPid("immediately after BEGIN");

    phase = "tracking-read";
    const tracked = await connection.unsafe(
      "select name from _migrations where name = $1",
      [fileName],
    ) as unknown[];
    if (tracked.length > 0) {
      await verifyFileBackendPid("before COMMIT of tracked-file recheck");
      phase = "commit";
      await connection.unsafe("commit");
      transactionStarted = false;
      return { status: "already-applied", statementCount: 0 };
    }

    await verifyFileBackendPid("before executing file statements");
    for (const [index, rawStatement] of statements.entries()) {
      phase = "statement";
      statementNumber = index + 1;
      await connection.unsafe(transactionalizeMigrationStatement(rawStatement));
    }

    await verifyFileBackendPid("before tracking insert");
    phase = "tracking-insert";
    await connection.unsafe(
      "insert into _migrations (name) values ($1)",
      [fileName],
    );
    await verifyFileBackendPid("before COMMIT");
    phase = "commit";
    await connection.unsafe("commit");
    transactionStarted = false;
    return { status: "applied", statementCount: statements.length };
  } catch (cause) {
    const outcomeUnknown = phase === "commit" && isConnectionLoss(cause);
    const causeError = asError(cause) as MigrationOperationalError;
    const primary = causeError.phase === "session-verify"
      ? causeError
      : createPhaseError(phase, cause, {
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

function backendPidFromRows(rows: unknown): number {
  const value = Number((rows as Array<{ backend_pid?: number | string }>)[0]?.backend_pid);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("pg_backend_pid() did not return a positive integer");
  }
  return value;
}

async function readBackendPid(connection: MigrationConnection): Promise<number> {
  const rows = await connection.unsafe(
    "select pg_backend_pid() as backend_pid",
  );
  return backendPidFromRows(rows);
}

async function verifyBackendPid(
  connection: MigrationConnection,
  expectedBackendPid: number,
  boundary: string,
  fileName?: string,
): Promise<void> {
  let observedBackendPid: number;
  try {
    observedBackendPid = await readBackendPid(connection);
  } catch (cause) {
    throw createPhaseError("session-verify", cause, {
      boundary,
      fileName,
      expectedBackendPid,
    });
  }
  if (observedBackendPid !== expectedBackendPid) {
    const cause = new Error(
      `PostgreSQL backend PID changed: expected ${expectedBackendPid}, observed ${observedBackendPid}`,
    );
    const error = createPhaseError("session-verify", cause, {
      boundary,
      fileName,
      expectedBackendPid,
      observedBackendPid,
    });
    error.message = `${fileName ? `Migration ${fileName}: ` : ""}`
      + `PostgreSQL backend PID changed during ${boundary}: `
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
    const lockRows = await runPhase("lock", () => connection.unsafe(
      "select pg_advisory_lock($1), pg_backend_pid() as backend_pid",
      [MIGRATION_ADVISORY_LOCK_KEY],
    ));
    lockHeld = true;
    try {
      expectedBackendPid = backendPidFromRows(lockRows);
    } catch (cause) {
      throw createPhaseError("session-verify", cause, {
        boundary: "advisory acquisition round trip",
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
            expectedBackendPid,
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
      const timeoutSeconds = options.poolEndTimeoutSeconds
        ?? MIGRATION_POOL_END_TIMEOUT_SECONDS;
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
        throw new Error("Migration connection pool shutdown timeout must be positive");
      }
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutFailure = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(
            `Migration connection pool shutdown timed out after ${timeoutSeconds} seconds`,
          ));
        }, timeoutSeconds * 1_000);
      });
      try {
        // Register our rejecting timer before postgres-js registers its
        // force-destroy timer. postgres-js resolves after forced teardown, so
        // the outer bound is what makes that timeout visible to the caller.
        await Promise.race([
          Promise.resolve().then(() => pool.end!({ timeout: timeoutSeconds })),
          timeoutFailure,
        ]);
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      }
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
