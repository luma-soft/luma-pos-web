"use client";

import { createContext, useContext } from "react";

const TenantClientScopeContext = createContext<string | null>(null);

export function TenantClientScopeProvider({
  scopeId,
  children,
}: {
  scopeId: string;
  children: React.ReactNode;
}) {
  return (
    <TenantClientScopeContext.Provider value={scopeId}>
      {children}
    </TenantClientScopeContext.Provider>
  );
}

export function useTenantClientScope() {
  const scopeId = useContext(TenantClientScopeContext);
  if (!scopeId) throw new Error("Tenant client scope is unavailable");
  return scopeId;
}
