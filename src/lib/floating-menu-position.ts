export interface FloatingMenuRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface FloatingMenuSize {
  width: number;
  height: number;
}

export interface FloatingMenuViewport {
  width: number;
  height: number;
}

export function positionFloatingMenu({
  trigger,
  menu,
  viewport,
  margin = 8,
  gap = 4,
}: {
  trigger: FloatingMenuRect;
  menu: FloatingMenuSize;
  viewport: FloatingMenuViewport;
  margin?: number;
  gap?: number;
}) {
  const availableAbove = Math.max(0, trigger.top - margin - gap);
  const availableBelow = Math.max(0, viewport.height - trigger.bottom - margin - gap);
  const placeAbove =
    menu.height <= availableAbove || availableAbove >= availableBelow;
  const maxHeight = placeAbove ? availableAbove : availableBelow;
  const visibleHeight = Math.min(menu.height, maxHeight);
  const top = placeAbove
    ? trigger.top - gap - visibleHeight
    : trigger.bottom + gap;
  const left = Math.min(
    Math.max(margin, trigger.right - menu.width),
    Math.max(margin, viewport.width - menu.width - margin),
  );

  return { left, top, maxHeight };
}
