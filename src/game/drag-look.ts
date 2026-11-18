type DragLookOptions = {
  signal: AbortSignal;
  enabled(): boolean;
  move(dx: number, dy: number): void;
  start?(): void;
  touch?: boolean;
};

/** The pointer stays available for UI clicks. Only an active camera drag turns the view. */
export function bindDragLook(surface: HTMLElement, options: DragLookOptions) {
  const { signal } = options;
  const document = surface.ownerDocument;
  let drag: { id: number; x: number; y: number; touch: boolean } | undefined;
  let suppressDragMenu = false;

  function cancel() {
    if (!drag) return;
    const { id } = drag;
    drag = undefined;
    if (surface.hasPointerCapture(id)) surface.releasePointerCapture(id);
  }

  surface.addEventListener('pointerdown', event => {
    const touch = event.pointerType === 'touch';
    if (drag || !options.enabled() ||
        (touch ? !options.touch : event.button !== 2)) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, touch };
    suppressDragMenu = !touch;
    event.preventDefault();
    surface.setPointerCapture(event.pointerId);
    options.start?.();
  }, { signal });

  surface.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    if (!options.enabled() || (!drag.touch && !(event.buttons & 2))) {
      cancel();
      return;
    }
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (dx || dy) options.move(dx, dy);
  }, { signal });

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    surface.addEventListener(type, event => {
      if (drag?.id === event.pointerId) cancel();
    }, { signal });
  }
  // The browser can target the element under the released pointer instead of the canvas.
  document.addEventListener('pointerdown', () => { suppressDragMenu = false; }, { signal, capture: true });
  document.addEventListener('contextmenu', event => {
    if (!suppressDragMenu || event.button !== 2) return;
    suppressDragMenu = false;
    event.preventDefault();
  }, { signal, capture: true });
  document.defaultView?.addEventListener('blur', cancel, { signal });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancel();
  }, { signal });
  signal.addEventListener('abort', cancel, { once: true });
  return cancel;
}
