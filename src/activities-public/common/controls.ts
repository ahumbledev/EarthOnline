const owners = new Set<() => boolean>();
export const activityOwnsInput = () => [...owners].some(active => active());
export function registerActivityInputOwner(active:()=>boolean){owners.add(active);return ()=>owners.delete(active);}

export function isTypingTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
}

export function isPlainActivityKey(event: KeyboardEvent) {
  return !event.defaultPrevented && !event.isComposing && event.keyCode !== 229
    && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !isTypingTarget(event.target);
}

export interface ActivityControlsOptions {
  active(): boolean;
  blocked?(): boolean;
  book?(): void;
  task?(): void;
  pause?(): void;
  primaryDown?(): void;
  primaryUp?(): void;
  suspend?(): void;
  canvas?: HTMLCanvasElement;
  mouse?: boolean;
  mouseReady?(): boolean;
}

/** Key and mouse sources release independently; releasing E never stops a still-held mouse. */
export function createActivityControls(options: ActivityControlsOptions) {
  const lifetime = new AbortController(), signal = lifetime.signal, held = new Set<string>();
  owners.add(options.active);
  function press(source: string) {
    if (held.has(source)) return;
    const first = held.size === 0; held.add(source);
    if (first) options.primaryDown?.();
  }
  function release(source: string) {
    if (!held.delete(source)) return;
    if (!held.size) options.primaryUp?.();
  }
  function suspend() {
    const wasHeld = held.size > 0; held.clear();
    // Interrupting a charge or editing stroke must not perform its release action.
    if(options.suspend)options.suspend();else if(wasHeld)options.primaryUp?.();
  }
  window.addEventListener('keydown', event => {
    if (!options.active() || !isPlainActivityKey(event) || options.blocked?.() || document.querySelector('dialog[open]')) return;
    if (event.target instanceof Element && (event.target.closest('[role="dialog"]')
      || event.code==='KeyE' && event.target.closest('button,a,summary'))) return;
    if (event.code === 'Tab' && event.target instanceof Element && event.target !== document.body && event.target.tagName !== 'CANVAS') return;
    const action = event.code === 'KeyB' ? options.book
      : event.code === 'KeyR' ? options.task : event.code === 'Escape' ? options.pause : undefined;
    if (event.code === 'KeyE' && options.primaryDown) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) press('key');
    } else if (action) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) { suspend(); action(); }
    }
  }, { signal, capture: true });
  window.addEventListener('keyup', event => { if (event.code === 'KeyE') release('key'); }, { signal, capture: true });
  if (options.canvas && options.mouse) {
    options.canvas.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch' || event.button !== 0 || options.mouseReady?.() === false || !options.active() || options.blocked?.() || document.querySelector('dialog[open]')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      // Chrome disallows explicit pointer capture while pointer lock owns the mouse.
      if(document.pointerLockElement!==options.canvas) options.canvas!.setPointerCapture(event.pointerId);
      press('pointer:' + event.pointerId);
    }, { signal, capture: true });
    window.addEventListener('pointerup', event => release('pointer:' + event.pointerId), { signal, capture: true });
    window.addEventListener('pointercancel', event => release('pointer:' + event.pointerId), { signal, capture: true });
    options.canvas.addEventListener('lostpointercapture', event => release('pointer:' + event.pointerId), { signal });
  }
  window.addEventListener('blur', suspend, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); }, { signal });
  document.addEventListener('focusin', event => { if (isTypingTarget(event.target)) suspend(); }, { signal });
  const dialogs = new MutationObserver(() => { if (document.querySelector('dialog[open]')) suspend(); });
  dialogs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  return { suspend, press: (source = 'button') => { if (options.active() && !options.blocked?.() && !document.querySelector('dialog[open]')) press(source); },
    release: (source = 'button') => release(source), get held() { return held.size > 0; }, dispose() { dialogs.disconnect(); suspend(); owners.delete(options.active); lifetime.abort(); } };
}

/** Desktop mouse look; unsupported locks retain the scene's drag-look/touch fallback. */
export function createActivityMouseLook(options: {
  canvas: HTMLCanvasElement; enabled(): boolean; look(x: number, y: number): void; lost?(): void;
}) {
  const lifetime = new AbortController(), signal = lifetime.signal;
  let unavailable = false, captured = false, disposed = false;
  function lock() {
    if (disposed || !options.enabled() || unavailable || document.pointerLockElement === options.canvas
      || !matchMedia('(pointer: fine)').matches || !options.canvas.requestPointerLock) return;
    try {
      const result = options.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      result?.catch(() => { unavailable = true; });
    } catch { unavailable = true; }
  }
  options.canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' || event.button !== 0 || !options.enabled() || unavailable
      || !matchMedia('(pointer: fine)').matches || !options.canvas.requestPointerLock || document.pointerLockElement === options.canvas) return;
    // This gesture acquires the view only. Its compatibility mousedown must not act.
    event.preventDefault(); event.stopImmediatePropagation(); lock();
  }, { signal, capture: true });
  document.addEventListener('mousemove', event => {
    if (document.pointerLockElement === options.canvas && options.enabled()
      && Math.abs(event.movementX) < 250 && Math.abs(event.movementY) < 250) options.look(event.movementX, event.movementY);
  }, { signal });
  document.addEventListener('pointerlockchange', () => {
    const next = document.pointerLockElement === options.canvas;
    if (captured && !next) options.lost?.();
    captured = next;
  }, { signal });
  return { lock, dispose() { disposed = true; lifetime.abort(); if (document.pointerLockElement === options.canvas) document.exitPointerLock(); } };
}
