"use client";

import { Suspense, useDeferredValue, type ReactNode } from "react";

/** Keep the last completed view visible while a refreshed server view suspends. */
export function KeepPreviousContent({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}) {
  const previousChildren = useDeferredValue(children);
  const hasPreviousContent = previousChildren !== children;

  return (
    <Suspense fallback={hasPreviousContent ? previousChildren : fallback}>
      {children}
    </Suspense>
  );
}
