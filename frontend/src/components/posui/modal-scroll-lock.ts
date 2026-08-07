const OVERLAY_ATTR = "data-posui-modal-overlay";
const OPEN_CLASS = "posui-modal-open";

let lockCount = 0;

function isScrollable(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  const y = style.overflowY;
  const x = style.overflowX;
  const scrollableY = y === "auto" || y === "scroll" || y === "overlay";
  const scrollableX = x === "auto" || x === "scroll" || x === "overlay";
  return (
    (scrollableY && el.scrollHeight > el.clientHeight) ||
    (scrollableX && el.scrollWidth > el.clientWidth)
  );
}

function canConsumeWheel(el: HTMLElement, deltaX: number, deltaY: number): boolean {
  if (!isScrollable(el)) return false;
  if (deltaY < 0 && el.scrollTop > 0) return true;
  if (deltaY > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
  if (deltaX < 0 && el.scrollLeft > 0) return true;
  if (deltaX > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
  return false;
}

function eventInsideOverlay(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest(`[${OVERLAY_ATTR}]`);
}

function preventBackgroundScroll(event: WheelEvent | TouchEvent) {
  const overlay = eventInsideOverlay(event.target);
  if (!overlay) {
    event.preventDefault();
    return;
  }

  if (event instanceof WheelEvent) {
    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) continue;
      if (node === overlay) break;
      if (canConsumeWheel(node, event.deltaX, event.deltaY)) return;
    }
    event.preventDefault();
    return;
  }

  // touchmove: allow only while the touch is over a scrollable modal region
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) continue;
    if (node === overlay) break;
    if (isScrollable(node)) return;
  }
  event.preventDefault();
}

const listenerOpts: AddEventListenerOptions = { passive: false, capture: true };

export function acquireModalScrollLock() {
  lockCount += 1;
  if (lockCount !== 1) return;
  document.documentElement.classList.add(OPEN_CLASS);
  document.addEventListener("wheel", preventBackgroundScroll, listenerOpts);
  document.addEventListener("touchmove", preventBackgroundScroll, listenerOpts);
}

export function releaseModalScrollLock() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount !== 0) return;
  document.documentElement.classList.remove(OPEN_CLASS);
  document.removeEventListener("wheel", preventBackgroundScroll, listenerOpts);
  document.removeEventListener("touchmove", preventBackgroundScroll, listenerOpts);
}

