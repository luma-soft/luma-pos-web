"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppDataRevision } from "@/components/app-data-sync-provider";
import { createRefreshQueue } from "@/lib/sync/refresh-queue";

type ReadState<T> = { loading: boolean; data?: T; error?: string };

/** Read-only state follows server revalidation; caller-owned edit drafts do not. */
export function useAppDataQuery<T>(
  key: string | null,
  load: (key: string, signal: AbortSignal) => Promise<T>,
) {
  const revision = useAppDataRevision();
  const [result, setResult] = useState<{ key: string; revision: string | null; state: ReadState<T> } | null>(null);
  const queueRef = useRef<ReturnType<typeof createRefreshQueue<T>> | null>(null);

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    const queue = createRefreshQueue({
      load: () => load(key, controller.signal),
      apply: (data) => { setResult({ key, revision, state: { loading: false, data } }); },
      onError: (cause) => {
        const error = cause instanceof Error && /^errors\.[\w.]+$/.test(cause.message)
          ? cause.message
          : "errors.serverError";
        setResult({ key, revision, state: { loading: false, error } });
      },
    });
    queueRef.current = queue;
    void queue.refresh();
    return () => {
      queue.dispose();
      controller.abort();
      queueRef.current = null;
    };
  }, [key, load, revision]);

  const refresh = useCallback(async () => { await queueRef.current?.refresh(); }, []);
  const state: ReadState<T> | null = key === null
    ? null
    : result?.key === key
      ? result.revision === revision
        ? result.state
        : { loading: true, data: result.state.data }
      : { loading: true };
  return { state, refresh };
}
