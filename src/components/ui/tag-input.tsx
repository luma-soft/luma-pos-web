"use client";

import * as React from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { TxValues } from "./_tx";
import { Button } from "./button";
import { Text } from "./text";

export interface TagInputProps {
  value: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  placeholderTx?: string;
  placeholderTxOptions?: TxValues;
  className?: string;
  disabled?: boolean;
  maxTags?: number;
  maxTagLength?: number;
  "aria-label"?: string;
}

export const TagInput = React.forwardRef<HTMLInputElement, TagInputProps>(
  ({ value, onChange, placeholder, placeholderTx, placeholderTxOptions, className, disabled, maxTags, maxTagLength, "aria-label": ariaLabel }, ref) => {
    const t = useTranslations();
    const [draft, setDraft] = React.useState("");
    const inputRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => inputRef.current!);

    const ph = placeholderTx ? t(placeholderTx, placeholderTxOptions) : placeholder;

    function add(raw: string) {
      const v = raw.trim();
      if (!v) return;
      if (value.includes(v)) return;
      if ((maxTags !== undefined && value.length >= maxTags) || (maxTagLength !== undefined && v.length > maxTagLength)) return;
      onChange([...value, v]);
      setDraft("");
    }

    function remove(idx: number) {
      onChange(value.filter((_, i) => i !== idx));
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        add(draft);
      } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
        remove(value.length - 1);
      }
    }

    return (
      <div
        onClick={() => inputRef.current?.focus()}
        className={cn(
          "flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5 cursor-text transition-[border-color,background-color] duration-150 focus-within:border-primary-600",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
      >
        {value.map((tag, idx) => (
          <Text
            as="span"
            key={idx}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary-50 text-primary-700 text-xs font-medium border border-primary-200"
          >
            {tag}
            <Button
              type="button"
              variant="ghost"
              size="iconSm"
              onClick={(e) => { e.stopPropagation(); remove(idx); }}
              disabled={disabled}
              aria-label={`${t("common.delete")}: ${tag}`}
              className="h-11 w-11 rounded-full p-0 hover:bg-primary-100 lg:h-4 lg:w-4"
            >
              <X className="w-3 h-3" />
            </Button>
          </Text>
        ))}
        <input
          ref={inputRef}
          type="text"
          style={{ outline: "none" }}
          value={draft}
          disabled={disabled || (maxTags !== undefined && value.length >= maxTags)}
          maxLength={maxTagLength}
          aria-label={ariaLabel}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => draft && add(draft)}
          placeholder={value.length === 0 ? ph : ""}
          className="min-h-11 min-w-[120px] flex-1 border-0 bg-transparent text-sm outline-none focus-visible:outline-none lg:min-h-0"
        />
      </div>
    );
  }
);
TagInput.displayName = "TagInput";
