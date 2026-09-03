/** A refresh requested after a write must not reuse a read started before it. */
export function createRefreshQueue<T>({
  load,
  apply,
  onError,
}: {
  load: () => Promise<T>;
  apply: (value: T) => void | Promise<void>;
  onError?: (error: unknown) => void;
}) {
  let requested = 0;
  let completed = 0;
  let running: Promise<void> | null = null;
  let disposed = false;

  return {
    refresh(): Promise<void> {
      if (disposed) return Promise.resolve();
      requested += 1;
      if (!running) {
        running = Promise.resolve().then(async () => {
          try {
            while (!disposed && completed < requested) {
              const version = requested;
              try {
                const value = await load();
                if (!disposed && version === requested) await apply(value);
              } catch (error) {
                if (!disposed && version === requested) onError?.(error);
              }
              completed = version;
            }
          } finally {
            // Clear inside the drain, not in a later promise callback: a
            // refresh queued as this drain settles must start another read.
            running = null;
          }
        });
      }
      return running;
    },
    dispose() {
      disposed = true;
    },
  };
}
