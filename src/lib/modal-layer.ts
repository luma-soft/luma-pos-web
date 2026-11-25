/**
 * App-wide stack of open modal layers (dialogs, drawers, sheets, full-screen
 * previews). It replaces per-modal `keydown` listeners and per-modal
 * `body.style.overflow` save/restore, which broke when several modals were
 * open at once:
 *
 * - Escape closes only the most recently opened layer. Controls that consume
 *   Escape themselves (an open picker, an inline editor) call
 *   `event.preventDefault()` and the layer is left open.
 * - Body scroll stays locked while at least one layer asks for it, whatever
 *   order the layers close in.
 * - A layer opened above another is always painted above it: when its
 *   overlay's own z-index is not higher than the layer below, it is raised.
 *   Portaled pickers and menus use `z-[1000]`, above every modal layer.
 */

export interface ModalLayerOptions {
  /** Called when Escape is pressed while this layer is on top. */
  onEscape?: () => void;
  /** Lock page scroll while this layer is open. */
  lockScroll?: boolean;
  /** The layer's `aria-modal` surface, used to tell it apart from unregistered modals. */
  getElement?: () => Element | null;
}

export interface ModalLayerHandle {
  readonly id: number;
  isTop(): boolean;
  release(): void;
}

interface Layer {
  id: number;
  options: ModalLayerOptions;
  /** Effective z-index of the layer's overlay, when it could be read. */
  z: number;
  restoreZ: (() => void) | null;
}

const MODAL_HOST_SELECTOR = '[aria-modal="true"], dialog[open]';

const layers: Layer[] = [];
let nextId = 1;
let listening = false;
let scrollLocks = 0;
let savedBodyOverflow = "";

export function getModalLayerCount() {
  return layers.length;
}

export function getScrollLockCount() {
  return scrollLocks;
}

/** Lock `document.body` scroll; the returned function releases this lock once. */
export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  if (scrollLocks === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLocks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks === 0) document.body.style.overflow = savedBodyOverflow;
  };
}

/**
 * Decide which layer, if any, should close for this keydown.
 * Exported for tests; `layerElements` is ordered bottom → top.
 *
 * Modals that are not registered handle their own Escape. The registered top
 * layer is skipped when such a modal holds focus, or when one is open above
 * it (last open modal surface in the document).
 */
export function pickEscapeLayer(
  event: Pick<KeyboardEvent, "key" | "defaultPrevented" | "isComposing">,
  layerElements: readonly (Element | null)[],
  focusHost: Element | null,
  lastOpenHost: Element | null = null,
): number {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return -1;
  if (layerElements.length === 0) return -1;
  const top = layerElements.length - 1;
  const isUnregistered = (host: Element | null) => host !== null && !layerElements.includes(host);
  if (isUnregistered(focusHost)) return -1;
  if (isUnregistered(lastOpenHost)) return -1;
  return top;
}

function onWindowKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  const target = event.target as Partial<Element> | null;
  const focusHost = typeof target?.closest === "function" ? target.closest(MODAL_HOST_SELECTOR) : null;
  const openHosts = Array.from(document.querySelectorAll(MODAL_HOST_SELECTOR))
    .filter((host) => host.getClientRects().length > 0);
  // Layers rendered but hidden (e.g. phone-only sheets on desktop) do not count.
  const visible = layers
    .map((layer) => ({ layer, element: layer.options.getElement?.() ?? null }))
    .filter(({ element }) => element === null || element.getClientRects().length > 0);
  const index = pickEscapeLayer(
    event,
    visible.map(({ element }) => element),
    focusHost,
    openHosts[openHosts.length - 1] ?? null,
  );
  const layer = visible[index]?.layer;
  if (!layer?.options.onEscape) return;
  event.preventDefault();
  layer.options.onEscape();
}

function syncListener() {
  if (typeof window === "undefined") return;
  const shouldListen = layers.length > 0;
  if (shouldListen === listening) return;
  listening = shouldListen;
  // Bubble phase on window: runs after the focused control and any
  // document-level picker listeners, so they can claim Escape first.
  if (shouldListen) window.addEventListener("keydown", onWindowKeyDown);
  else window.removeEventListener("keydown", onWindowKeyDown);
}

/** The element that positions the layer on screen: the surface or its nearest fixed ancestor. */
function overlayOf(element: Element | null): HTMLElement | null {
  if (typeof HTMLElement === "undefined" || !(element instanceof HTMLElement)) return null;
  // Native modal dialogs render in the browser's top layer; z-index does not apply.
  if (typeof HTMLDialogElement !== "undefined" && element instanceof HTMLDialogElement) return null;
  for (let node: HTMLElement | null = element; node && node !== document.body; node = node.parentElement) {
    if (window.getComputedStyle(node).position === "fixed") return node;
  }
  return null;
}

function readZ(element: HTMLElement) {
  const value = Number.parseInt(window.getComputedStyle(element).zIndex, 10);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Raise `overlay` (and a full-screen backdrop rendered just before it) to
 * `minZ` when its own z-index is lower. Returns the effective z-index and a
 * function restoring the original inline styles.
 */
export function raiseLayerOverlay(overlay: HTMLElement, minZ: number): { z: number; restore: (() => void) | null } {
  const ownZ = readZ(overlay);
  if (ownZ >= minZ) return { z: ownZ, restore: null };
  const targets = [overlay];
  const backdrop = overlay.previousElementSibling;
  if (
    backdrop instanceof HTMLElement &&
    window.getComputedStyle(backdrop).position === "fixed" &&
    readZ(backdrop) <= ownZ
  ) {
    targets.push(backdrop);
  }
  const previous = targets.map((target) => target.style.zIndex);
  for (const target of targets) target.style.zIndex = String(minZ);
  return {
    z: minZ,
    restore: () => targets.forEach((target, index) => { target.style.zIndex = previous[index]; }),
  };
}

function applyStacking(layer: Layer) {
  const overlay = overlayOf(layer.options.getElement?.() ?? null);
  if (!overlay) return;
  const below = layers
    .filter((other) => other !== layer)
    .reduce((max, other) => Math.max(max, other.z), Number.NEGATIVE_INFINITY);
  const { z, restore } = raiseLayerOverlay(overlay, Number.isFinite(below) ? below + 1 : 0);
  layer.z = z;
  layer.restoreZ = restore;
}

export function pushModalLayer(options: ModalLayerOptions): ModalLayerHandle {
  const layer: Layer = { id: nextId++, options, z: Number.NEGATIVE_INFINITY, restoreZ: null };
  applyStacking(layer);
  layers.push(layer);
  const unlock = options.lockScroll ? lockBodyScroll() : null;
  syncListener();
  let released = false;
  return {
    id: layer.id,
    isTop: () => layers[layers.length - 1] === layer,
    release() {
      if (released) return;
      released = true;
      const index = layers.indexOf(layer);
      if (index >= 0) layers.splice(index, 1);
      layer.restoreZ?.();
      unlock?.();
      syncListener();
    },
  };
}
