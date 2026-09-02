"use client";

import NextImage from "next/image";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, Minus, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ImageTransform = { scale: number; x: number; y: number };
type Point = { x: number; y: number };
export const FIT_IMAGE: ImageTransform = { scale: 1, x: 0, y: 0 };

/** Keep the point under the cursor/fingers fixed while zooming. */
export function zoomProjectImage(current: ImageTransform, scale: number, focal: Point): ImageTransform {
  const next = Math.min(6, Math.max(1, scale));
  if (next === 1) return { ...FIT_IMAGE };
  const ratio = next / current.scale;
  return { scale: next, x: focal.x - (focal.x - current.x) * ratio, y: focal.y - (focal.y - current.y) * ratio };
}

export function constrainProjectImage(value: ImageTransform, width: number, height: number): ImageTransform {
  const maxX = (value.scale - 1) * width / 2;
  const maxY = (value.scale - 1) * height / 2;
  return { ...value, x: Math.min(maxX, Math.max(-maxX, value.x)), y: Math.min(maxY, Math.max(-maxY, value.y)) };
}

export function ProjectImageViewport({ url, fileName, onRetry }: {
  url: string;
  fileName: string;
  onRetry: () => void;
}) {
  const t = useTranslations("projectMedia");
  const root = useRef<HTMLDivElement>(null);
  const transform = useRef<ImageTransform>({ ...FIT_IMAGE });
  const [view, setView] = useState<ImageTransform>({ ...FIT_IMAGE });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const moved = useRef(false);
  const lastTap = useRef<{ time: number; point: Point } | null>(null);
  const lastTouch = useRef(0);

  function update(next: ImageTransform) {
    const rect = root.current?.getBoundingClientRect();
    const bounded = rect ? constrainProjectImage(next, rect.width, rect.height) : next;
    transform.current = bounded;
    setView(bounded);
  }

  function point(clientX: number, clientY: number): Point {
    const rect = root.current!.getBoundingClientRect();
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }

  function toggleZoom(focal: Point) {
    update(zoomProjectImage(transform.current, transform.current.scale > 1.01 ? 1 : 2.5, focal));
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, point(event.clientX, event.clientY));
    moved.current = pointers.current.size > 1;
    if (event.pointerType === "touch") lastTouch.current = Date.now();
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const before = [...pointers.current.values()];
    const next = point(event.clientX, event.clientY);
    if (Math.hypot(next.x - previous.x, next.y - previous.y) > 2) moved.current = true;
    pointers.current.set(event.pointerId, next);
    const after = [...pointers.current.values()];
    if (after.length >= 2) {
      const distance = (points: Point[]) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const center = (points: Point[]) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
      const oldCenter = center(before);
      const newCenter = center(after);
      const zoomed = zoomProjectImage(transform.current, transform.current.scale * distance(after) / Math.max(1, distance(before)), oldCenter);
      update({ ...zoomed, x: zoomed.x + newCenter.x - oldCenter.x, y: zoomed.y + newCenter.y - oldCenter.y });
    } else if (transform.current.scale > 1) {
      update({ ...transform.current, x: transform.current.x + next.x - previous.x, y: transform.current.y + next.y - previous.y });
    }
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch" && !moved.current && pointers.current.size === 1) {
      const next = point(event.clientX, event.clientY);
      const prior = lastTap.current;
      if (prior && Date.now() - prior.time < 300 && Math.hypot(next.x - prior.point.x, next.y - prior.point.y) < 24) {
        toggleZoom(next);
        lastTap.current = null;
      } else lastTap.current = { time: Date.now(), point: next };
    }
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const rect = element!.getBoundingClientRect();
      const focal = { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
      const next = constrainProjectImage(
        zoomProjectImage(transform.current, transform.current.scale * Math.exp(-event.deltaY * 0.002), focal),
        rect.width, rect.height,
      );
      transform.current = next;
      setView(next);
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={root}
        data-testid="project-image-viewport"
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
        style={{ cursor: view.scale > 1 ? "grab" : "zoom-in" }}
        tabIndex={0}
        role="region"
        aria-label={t("zoomHint")}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={(event) => { pointers.current.delete(event.pointerId); moved.current = true; lastTap.current = null; }}
        onLostPointerCapture={(event) => pointers.current.delete(event.pointerId)}
        onDoubleClick={(event) => { if (Date.now() - lastTouch.current > 500) toggleZoom(point(event.clientX, event.clientY)); }}
        onKeyDown={(event) => {
          if (event.key === "+" || event.key === "=") { event.preventDefault(); update(zoomProjectImage(transform.current, transform.current.scale * 1.5, { x: 0, y: 0 })); }
          if (event.key === "-") { event.preventDefault(); update(zoomProjectImage(transform.current, transform.current.scale / 1.5, { x: 0, y: 0 })); }
          if (event.key === "0") { event.preventDefault(); update({ ...FIT_IMAGE }); }
        }}
      >
        <div data-testid="project-image-transform" className="absolute inset-0 will-change-transform" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <NextImage src={url} alt={fileName} fill unoptimized draggable={false} className="pointer-events-none object-contain"
            onLoad={() => { setLoading(false); setFailed(false); }}
            onError={() => { setLoading(false); setFailed(true); }} />
        </div>
        {loading && <div role="status" aria-label={t("loadingLabel")} className="pointer-events-none absolute inset-0 grid place-items-center text-white"><LoaderCircle className="h-7 w-7 animate-spin" /></div>}
        {failed && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black text-white">
          <p>{t("openError")}</p>
          <Button type="button" variant="outline" onPointerDown={(event) => event.stopPropagation()} onClick={onRetry}><RefreshCw className="h-4 w-4" />{t("retry")}</Button>
        </div>}
      </div>
      <div className="shrink-0 border-t border-border-soft bg-surface px-3 py-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] text-center">
        <div className="flex items-center justify-center gap-2">
          <Button type="button" variant="ghost" size="sm" aria-label={t("zoomOut")} disabled={view.scale <= 1} onClick={() => update(zoomProjectImage(view, view.scale / 1.5, { x: 0, y: 0 }))}><Minus className="h-4 w-4" /></Button>
          <output className="w-12 text-sm tabular-nums">{Math.round(view.scale * 100)}%</output>
          <Button type="button" variant="ghost" size="sm" aria-label={t("zoomIn")} disabled={view.scale >= 6} onClick={() => update(zoomProjectImage(view, view.scale * 1.5, { x: 0, y: 0 }))}><Plus className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => update({ ...FIT_IMAGE })}>{t("fitImage")}</Button>
        </div>
        <p className="mt-1 text-xs text-slate-500">{t("zoomHint")}</p>
      </div>
    </div>
  );
}
