"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { TxValues } from "./_tx";
import { Text } from "./text";

export interface SectionProps {
  id?: string;
  title?: React.ReactNode;
  titleTx?: string;
  titleTxOptions?: TxValues;
  description?: React.ReactNode;
  descriptionTx?: string;
  descriptionTxOptions?: TxValues;
  collapsible?: boolean;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function Section({
  id,
  title, titleTx, titleTxOptions,
  description, descriptionTx, descriptionTxOptions,
  collapsible = true, defaultOpen = true, action, className, children,
}: SectionProps) {
  const t = useTranslations();
  const [open, setOpen] = React.useState(defaultOpen);

  const titleContent = titleTx ? t(titleTx, titleTxOptions) : title;
  const descContent = descriptionTx ? t(descriptionTx, descriptionTxOptions) : description;

  return (
    <div id={id} className={cn(
      "bg-surface border border-border-soft rounded-card shadow-e1",
      className
    )}>
      <div
        className={cn(
          "flex items-center justify-between p-4",
          collapsible && "cursor-pointer select-none"
        )}
        onClick={collapsible ? () => setOpen(!open) : undefined}
      >
        <div className="flex-1 min-w-0">
          {titleContent && <Text as="div" weight="semibold">{titleContent}</Text>}
          {descContent && (
            <Text as="div" variant="muted" size="xs" className="mt-0.5">{descContent}</Text>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          {action}
          {collapsible && (
            <ChevronDown
              className={cn(
                "w-4 h-4 text-slate-400 transition-transform",
                !open && "rotate-180"
              )}
            />
          )}
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4 pt-0 border-t border-border-soft">
          <div className="pt-4">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
