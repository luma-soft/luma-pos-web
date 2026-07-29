import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";

type ServiceDatabase = NodePgDatabase<typeof schema>;
export type ServiceReadTransaction = Parameters<
  Parameters<ServiceDatabase["transaction"]>[0]
>[0];

export async function readRepeatableSnapshot<TFirst, TSecond>(
  database: ServiceDatabase,
  reads: {
    first: (tx: ServiceReadTransaction) => Promise<TFirst>;
    second: (tx: ServiceReadTransaction, first: TFirst) => Promise<TSecond>;
  },
) {
  return database.transaction(async (tx) => {
    const first = await reads.first(tx);
    const second = await reads.second(tx, first);
    return { first, second };
  }, {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

export type RepeatableSnapshotReader = typeof readRepeatableSnapshot;
