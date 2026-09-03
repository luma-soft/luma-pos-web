import { describe, expect, test } from "bun:test";
import { createRefreshQueue } from "@/lib/sync/refresh-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("refresh after a successful mutation", () => {
  test("does not apply an in-flight pre-save read and waits for a post-save read", async () => {
    const beforeSave = deferred<number>();
    const afterSave = deferred<number>();
    const applied: number[] = [];
    let reads = 0;
    const queue = createRefreshQueue({
      load: () => (++reads === 1 ? beforeSave.promise : afterSave.promise),
      apply: (stock) => { applied.push(stock); },
    });
    const initial = queue.refresh();
    await Promise.resolve();
    const saved = queue.refresh();
    beforeSave.resolve(-1);
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).toEqual([]);
    expect(reads).toBe(2);
    afterSave.resolve(5);
    await Promise.all([initial, saved]);
    expect(applied).toEqual([5]);
  });

  test("coalesces concurrent invalidations but performs another read for later writes", async () => {
    const first = deferred<string[]>();
    let reads = 0;
    const applied: string[][] = [];
    const queue = createRefreshQueue({
      load: async () => ++reads === 1 ? first.promise : ["created", "updated"],
      apply: (rows) => { applied.push(rows); },
    });
    const pending = queue.refresh();
    await Promise.resolve();
    const afterCreate = queue.refresh();
    const afterUpdate = queue.refresh();
    first.resolve(["deleted"]);
    await Promise.all([pending, afterCreate, afterUpdate]);
    expect(reads).toBe(2);
    expect(applied).toEqual([["created", "updated"]]);
    await queue.refresh();
    expect(reads).toBe(3);
  });

  test("does not publish fake state when a read fails and allows retry", async () => {
    let fail = true;
    const applied: number[] = [];
    const errors: unknown[] = [];
    const queue = createRefreshQueue({
      load: async () => { if (fail) throw new Error("offline"); return 3; },
      apply: (stock) => { applied.push(stock); },
      onError: (error) => { errors.push(error); },
    });
    await queue.refresh();
    expect(applied).toEqual([]);
    expect(errors).toHaveLength(1);
    fail = false;
    await queue.refresh();
    expect(applied).toEqual([3]);
  });

  test("disposal prevents an old tenant or unmounted reader publishing data", async () => {
    const pending = deferred<number>();
    const applied: number[] = [];
    const queue = createRefreshQueue({ load: () => pending.promise, apply: (value) => { applied.push(value); } });
    const refresh = queue.refresh();
    await Promise.resolve();
    queue.dispose();
    pending.resolve(7);
    await refresh;
    expect(applied).toEqual([]);
  });
});
