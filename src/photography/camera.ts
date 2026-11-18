import { t } from '../activities-public/language.ts';
import './style.css';
/** Capture the just-rendered game canvas; HTML controls are never composited. */
export function createWorldCamera(options: {
  canvas: HTMLCanvasElement; host?: HTMLElement; button?: HTMLButtonElement; active?(): boolean; ready(): boolean | string;
  changed(): void; opened(): void; notify(message: string): void;
  /** Street cameras enter clean, live framing before taking a photograph. */
  previewChanged?(active: boolean): void;
}) {
  const dialog = document.createElement('dialog'); dialog.className = 'world-photo'; dialog.setAttribute('aria-label', t`照片预览`);
  dialog.innerHTML = `<header><h2>${t`刚拍的照片`}</h2><button type="button" data-photo="close" aria-label="${t`关闭照片`}">×</button></header><img alt="${t`在当前游戏场景拍摄的照片`}"><div class="world-photo-actions"><button type="button" data-photo="close">${t`返回取景`}</button><button type="button" data-photo="save">${t`保存照片`}</button></div>`;
  (options.host ?? options.button?.parentElement ?? document.body).append(dialog);
  const abort = new AbortController(); let pending = false, encoding = false, disposed = false, generation = 0, url = '', fileName = '';
  let previewing = false;
  const controls = document.createElement('div'); controls.className = 'world-photo-framing'; controls.hidden = true;
  controls.innerHTML = `<button type="button" data-frame="close">${t`退出取景`}</button><button type="button" data-frame="capture">${t`拍照 Y`}</button>`;
  if (options.previewChanged) (options.host ?? document.body).append(controls);
  const setPreview = (value: boolean) => {
    if (previewing === value) return;
    previewing = value; controls.hidden = !value; options.previewChanged?.(value);
  };
  const button = options.button;
  if (button) {
    button.textContent = t`拍照 Y`; button.title = t`拍摄当前场景 Y`; button.setAttribute('aria-keyshortcuts', 'Y');
  }
  const enabled = () => options.active?.() !== false && !options.host?.closest('[hidden]');
  function request() {
    if (!enabled() || disposed || pending || encoding || dialog.open) return;
    const ready = options.ready();
    if (ready !== true) { options.notify(typeof ready === 'string' ? ready : t`进入街区后即可拍照。`); return; }
    if (options.previewChanged && !previewing) { setPreview(true); options.changed(); options.canvas.focus({ preventScroll: true }); return; }
    pending = true; if (button) button.disabled = true; options.changed();
  }
  function close() {
    const wasPreviewing = previewing;
    generation++; pending = false; encoding = false; if (button) button.disabled = false;
    if (dialog.open) dialog.close();
    if (url) { URL.revokeObjectURL(url); url = ''; }
    dialog.querySelector('img')!.removeAttribute('src'); setPreview(false); options.changed();
    if (wasPreviewing && !disposed && enabled()) options.canvas.focus({ preventScroll: true });
  }
  controls.addEventListener('click', event => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-frame]')?.dataset.frame;
    if (action === 'capture') { request(); options.canvas.focus({ preventScroll: true }); }
    if (action === 'close') close();
  }, { signal: abort.signal });
  // Hidden street actions must not run behind the viewfinder. Walking/looking
  // stay available; Tab exits the frame and Escape exits framing.
  window.addEventListener('keydown', event => {
    if (!previewing || dialog.open) return;
    if (event.code === 'Tab') { close(); return; }
    if (event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
    if (!/^(Key[WASDY]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Space)$/.test(event.code)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, { capture: true, signal: abort.signal });
  button?.addEventListener('click', request, { signal: abort.signal });
  window.addEventListener('keydown', event => {
    if (!enabled() || event.code !== 'KeyY' || event.repeat || event.isComposing || event.defaultPrevented
      || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input,select,textarea,[contenteditable],[role=textbox]'))) return;
    if (document.querySelector('dialog:modal,[role=dialog][aria-modal=true]:not([hidden])')) return;
    event.preventDefault(); request();
  }, { signal: abort.signal });
  // Native modality makes the canvas inert, but keyboard events still bubble.
  // Keep painting, movement and other global tools outside this photo preview.
  dialog.addEventListener('keydown', event => event.stopPropagation(), { signal: abort.signal });
  dialog.addEventListener('keyup', event => event.stopPropagation(), { signal: abort.signal });
  dialog.addEventListener('click', event => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-photo]')?.dataset.photo;
    if (action === 'close') dialog.close();
    if (action === 'save' && url) {
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; document.body.append(anchor); anchor.click(); anchor.remove();
    }
  }, { signal: abort.signal });
  dialog.addEventListener('close', options.changed, { signal: abort.signal });
  function fail() { encoding = false; if (button) button.disabled = false; options.notify(t`照片未能生成，请重新拍摄。`); }
  return {
    request,
    close,
    get previewing() { return previewing; },
    get pending() { return pending; }, get isOpen() { return dialog.open; },
    afterRender() {
      if (!pending || disposed) return;
      pending = false; encoding = true; const token = generation;
      try { options.canvas.toBlob(blob => {
        if (disposed || generation !== token) return;
        if (!enabled()) { encoding = false; if (button) button.disabled = false; return; }
        if (!blob) { fail(); return; }
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(blob); fileName = `EarthOnline-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        dialog.querySelector('img')!.src = url; encoding = false; if (button) button.disabled = false;
        options.opened(); dialog.showModal(); options.changed();
      }, 'image/png'); } catch { fail(); }
    },
    dispose() { if (disposed) return; close(); disposed = true; abort.abort(); dialog.remove(); controls.remove(); },
  };
}
