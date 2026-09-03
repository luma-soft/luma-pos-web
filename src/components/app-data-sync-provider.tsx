"use client";

import { createContext, useContext } from "react";

const AppDataRevisionContext = createContext<string | null>(null);

/** A new server render invalidates client-owned read models, not edit drafts. */
export function AppDataSyncProvider({
  revision,
  children,
}: {
  revision: string;
  children: React.ReactNode;
}) {
  return <AppDataRevisionContext.Provider value={revision}>{children}</AppDataRevisionContext.Provider>;
}

export function useAppDataRevision() {
  return useContext(AppDataRevisionContext);
}
