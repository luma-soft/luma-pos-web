"use client";

import { Children, createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type TabContextValue = { active: string; setActive: (id: string) => void };
const TabContext = createContext<TabContextValue | null>(null);

export function ProjectServiceTabs({ children, initialActive }: { children: ReactNode; initialActive?: string }) {
  const items = useMemo(() => Children.toArray(children).filter((child): child is React.ReactElement<ProjectServiceTabProps> => Boolean(child && typeof child === "object" && "props" in child)), [children]);
  const [active, setActive] = useState(initialActive ?? items[0]?.props.id ?? "");

  return (
    <TabContext.Provider value={{ active, setActive }}>
      <div className="rounded-card border border-border bg-surface overflow-hidden">
        <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border-soft p-2 [&::-webkit-scrollbar]:h-0">
          {items.map((item) => {
            const selected = item.props.id === active;
            return (
              <button
                key={item.props.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(item.props.id)}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3.5 text-xs font-semibold transition-colors",
                  selected ? "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300" : "text-slate-500 hover:bg-surface-2 hover:text-slate-900 dark:hover:text-slate-200",
                )}
              >
                {item.props.label}
              </button>
            );
          })}
        </div>
        {children}
      </div>
    </TabContext.Provider>
  );
}

export type ProjectServiceTabProps = {
  id: string;
  label: string;
  count?: number;
  children: ReactNode;
};

export function ProjectServiceTab({ id, children }: ProjectServiceTabProps) {
  const context = useContext(TabContext);
  const active = context?.active === id;
  return (
    <div role="tabpanel" hidden={!active} className={cn("p-4", active && "block")}>
      {children}
    </div>
  );
}
