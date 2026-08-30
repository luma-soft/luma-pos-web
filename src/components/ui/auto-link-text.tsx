import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const TRAILING_PUNCTUATION_PATTERN = /[),.!?;:}\]]+$/u;

function linkifiedParts(value: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of value.matchAll(URL_PATTERN)) {
    const start = match.index;
    const candidate = match[0];
    const trailing = candidate.match(TRAILING_PUNCTUATION_PATTERN)?.[0] ?? "";
    const url = candidate.slice(0, candidate.length - trailing.length);

    if (start > cursor) parts.push(value.slice(cursor, start));
    parts.push(
      <a
        key={`${start}-${url}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 min-w-11 max-w-full [overflow-wrap:anywhere] text-primary-600 underline decoration-primary-300 underline-offset-2 transition hover:text-primary-700 lg:min-h-0 lg:min-w-0"
      >
        {url}
      </a>,
    );
    if (trailing) parts.push(trailing);
    cursor = start + candidate.length;
  }

  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts;
}

export function AutoLinkText({
  children,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<"span">, "children"> & {
  children: string;
}) {
  return (
    <span className={cn("whitespace-pre-wrap", className)} {...props}>
      {linkifiedParts(children)}
    </span>
  );
}
