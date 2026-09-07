"use client";

import Image, { type ImageProps } from "next/image";
import { ImageOff } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

type LumaImageProps = Omit<ImageProps, "onLoad" | "onError" | "src"> & {
  src: string;
  containerClassName?: string;
  fallbackLabel?: string;
};

/** Shared image surface that never flashes white while a remote image loads. */
export function LumaImage({
  alt,
  className,
  containerClassName,
  fallbackLabel,
  src,
  ...props
}: LumaImageProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const state = failedSrc === src
    ? "failed"
    : loadedSrc === src
      ? "ready"
      : "loading";

  return (
    <span
      className={cn(
        "relative block overflow-hidden bg-surface-2",
        containerClassName,
      )}
    >
      {state !== "failed" && (
        <Image
          {...props}
          src={src}
          alt={alt}
          className={cn(
            "transition-opacity duration-200",
            state === "ready" ? "opacity-100" : "opacity-0",
            className,
          )}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
        />
      )}
      {state === "loading" && (
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-pulse bg-surface-2"
        />
      )}
      {state === "failed" && (
        <span
          role="img"
          aria-label={fallbackLabel ?? alt}
          className="absolute inset-0 grid place-items-center bg-surface-2 text-slate-400"
        >
          <ImageOff className="h-6 w-6" />
        </span>
      )}
    </span>
  );
}
