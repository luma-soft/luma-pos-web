"use client";

import {
  Children,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

type ReportTab = {
  id: string;
  label: string;
};

export function ReportBreakdownTabs({
  tabs,
  children,
  ariaLabel,
}: {
  tabs: readonly ReportTab[];
  children: ReactNode;
  ariaLabel: string;
}) {
  const panels = Children.toArray(children);
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const instanceId = useId().replaceAll(":", "");

  function selectTab(index: number) {
    const nextIndex = (index + tabs.length) % tabs.length;
    setActiveIndex(nextIndex);
    tabRefs.current[nextIndex]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectTab(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectTab(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectTab(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectTab(tabs.length - 1);
    }
  }

  return (
    <section>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex gap-1 overflow-x-auto rounded-card border border-border bg-surface px-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab, index) => {
          const active = index === activeIndex;
          const tabId = `${instanceId}-tab-${tab.id}`;
          const panelId = `${instanceId}-panel-${tab.id}`;

          return (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={tabId}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              onClick={() => setActiveIndex(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn(
                "relative h-11 shrink-0 rounded-t-[10px] px-4 text-sm font-semibold outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset",
                active
                  ? "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300"
                  : "text-slate-500 hover:bg-surface-2 hover:text-slate-900 dark:hover:text-slate-200",
                active && "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary-600",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          id={`${instanceId}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${instanceId}-tab-${tab.id}`}
          tabIndex={0}
          hidden={index !== activeIndex}
          className="mt-5 outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset"
        >
          {panels[index]}
        </div>
      ))}
    </section>
  );
}
