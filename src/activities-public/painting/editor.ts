import { MAX_ARTWORK_CHARS, compactDrawing, quantizePoint, MAX_POINTS, MAX_STROKES, PALETTE, parseDrawing, renderDrawing, renderStrokePoint, sprayTicks, steadyPoint, type BrushKind, type Drawing, type Stroke } from './drawing.ts';
import { t, tc } from '../language.ts';

interface EditorOptions {
  host?: HTMLElement;
  initial?: string;
  title?: string;
  saveText?: string;
  aspect?: number;
  onSave(drawing: Drawing): void | { next: Drawing; notice: string } | Promise<void | { next: Drawing; notice: string }>;
  onDraft?(drawing: Drawing): void;
  onClose?(): void;
  onPaint?(canvas: HTMLCanvasElement): void;
  onStrokePoint?(point: [number, number]): void;
  savePending?(): boolean;
  mountPreview?(host: HTMLElement, canvas: HTMLCanvasElement, read: () => Drawing): { update(): void; dispose(): void };
}

export function openPaintingEditor(options: EditorOptions) {
  // Validate before mounting, so a damaged draft never leaves a broken dialog.
  let drawing: Drawing = options.initial ? compactDrawing(parseDrawing(options.initial)) : { version: 1, strokes: [], aspect: options.aspect ?? .7 };
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const lifetime = new AbortController(), { signal } = lifetime;
  const host = document.createElement('section'); host.id = 'item-drawing-editor';
  host.className = 'painting-editor'; host.setAttribute('role', 'dialog'); host.setAttribute('aria-modal', 'true'); host.setAttribute('aria-label', options.title ?? t`随身画板`);
  host.innerHTML = `<header class="painting-header"><div><small>${t`街头写生`}</small><h2></h2></div><button type="button" data-draw="close" aria-label="${t`收起画板`}" title="${t`收起画板 · Esc`}">${t`收起`} <kbd>Esc</kbd></button></header>
    <div class="painting-workspace"><div class="painting-paper"><canvas aria-label="${t`绘画画布`}" tabindex="0"></canvas></div>
    <aside class="painting-kit" aria-label="${t`绘画工具盘`}"><div class="painting-tools" role="group" aria-label="${t`绘画工具`}"><button type="button" data-brush="brush" aria-pressed="true" title="${t`画笔 · 1`}"><span>${t`画笔`}</span><kbd>1</kbd></button><button type="button" data-brush="spray" aria-pressed="false" title="${t`喷枪 · 2`}"><span>${t`喷枪`}</span><kbd>2</kbd></button><button type="button" data-brush="steady" aria-pressed="false" title="${t`精细笔 · 3`}"><span>${t`精细笔`}</span><kbd>3</kbd></button></div>
    <div class="painting-colors"><div class="painting-palette" role="group" aria-label="${t`预设颜色`}"></div><label class="painting-color"><span>${t`当前颜色`}</span><input type="color" value="#357fa6" aria-label="${t`画笔颜色`}"><span class="painting-color-value">#357FA6</span></label><label class="painting-size"><span>${t`笔宽`}</span><input type="range" min="2" max="100" value="14" aria-label="${t`笔宽`}"><span><output>14</output> px</span></label></div>
    <div class="painting-edits"><button type="button" data-draw="undo" title="${t`撤销 · Ctrl Z`}">${tc('画板')`撤销`}</button><button type="button" data-draw="clear" title="${t`清空画布`}">${t`清空`}</button></div><button type="button" data-draw="save"></button></aside></div>
    <div class="painting-extras"><button type="button" data-draw="export">${t`导出 PNG`}</button><span class="painting-tool-help">${t`圆头画笔，随手画下眼前的风景。`}</span></div>
    <footer class="painting-footer"><p role="status" aria-live="polite">${options.onDraft ? t`草稿自动保存在此浏览器` : t`完成后保存到当前道具`}</p></footer>`;
  host.querySelector('h2')!.textContent = options.title ?? t`随身画板`;
  const budget=document.createElement('output');budget.className='painting-budget';budget.setAttribute('aria-label',t`剩余画稿容量`);
  const discard=document.createElement('button');discard.type='button';discard.textContent=t`导出备份后收起`;discard.hidden=true;
  host.querySelector('.painting-extras')!.append(budget,discard);
  const saveButton = host.querySelector<HTMLButtonElement>('[data-draw=save]')!;
  saveButton.textContent = options.saveText ?? t`保存并收起`;
  const canvas = host.querySelector('canvas')!, color = host.querySelector<HTMLInputElement>('[type=color]')!, width = host.querySelector<HTMLInputElement>('[type=range]')!;
  canvas.width = 1024; canvas.height = Math.round(1024 / (drawing.aspect ?? 1));
  canvas.style.aspectRatio = String(canvas.width / canvas.height);
  const notice = (text: string) => { host.querySelector('[role=status]')!.textContent = text; };
  const undo = host.querySelector<HTMLButtonElement>('[data-draw=undo]')!;
  let tool: BrushKind = 'brush', active: Stroke | undefined, pointer: number | undefined, target: [number, number] = [0, 0], filtered: [number, number] = [0, 0];
  const toolWidths: Record<BrushKind, number> = { brush: 14, spray: 64, steady: 8 };
  let frame = 0, lastTime = 0, remainder = 0, closed = false, saving = false, dirty = false;
  let pointCount = drawing.strokes.reduce((count, stroke) => count + stroke.points.length, 0);
  const history: Drawing[] = [];
  const mount = options.host ?? document.body; mount.append(host);
  let preview: ReturnType<NonNullable<EditorOptions['mountPreview']>> | undefined;
  try { preview = options.mountPreview?.(host, canvas, () => drawing); }
  catch (error) { lifetime.abort(); host.remove(); throw error; }
  const changed = () => { options.onPaint?.(canvas); preview?.update(); };
  let usedChars=JSON.stringify(drawing).length;
  const updateBudget=()=>{budget.textContent=t`画稿容量剩余 ${Math.max(0,Math.floor((MAX_ARTWORK_CHARS-usedChars)/MAX_ARTWORK_CHARS*100))}%`;};
  const redraw = () => { usedChars=JSON.stringify(drawing).length;updateBudget();renderDrawing(canvas, drawing); changed(); undo.disabled = history.length === 0; };
  const remember = () => { history.push({ ...drawing, strokes: [...drawing.strokes] }); if (history.length > 40) history.shift(); undo.disabled = false; };
  const persistDraft = () => {
    if (!dirty || !options.onDraft) return true;
    try { options.onDraft(parseDrawing(JSON.stringify(drawing))); dirty = false; notice(t`草稿已保存到当前浏览器。`); return true; }
    catch (error) { discard.hidden=false;notice(t`草稿未保存：${String(error)}。请导出 PNG 备份后重试。`); return false; }
  };
  const finishStroke = () => {
    cancelAnimationFrame(frame); frame = 0;
    const captured = pointer; pointer = undefined; active = undefined;
    if (captured !== undefined && canvas.hasPointerCapture(captured)) canvas.releasePointerCapture(captured);
    preview?.update(); persistDraft();
  };
  const close = (force = false) => {
    if (closed || saving && !force) return;
    finishStroke();
    if (!force && !persistDraft()) return;
    closed = true; lifetime.abort(); preview?.dispose(); host.remove(); mount.classList.remove('painting-active'); options.onClose?.(); previousFocus?.focus({ preventScroll: true });
  };
  const exportPng=()=>{const link=document.createElement('a');link.download=t`sketch.png`;link.href=canvas.toDataURL('image/png');link.click();notice(t`已导出 PNG。`);};
  discard.onclick=()=>{try{exportPng();close(true);}catch{notice(t`无法导出，请保留画板并重试。`);}};
  const point = (event: PointerEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  };
  const append = (value: [number, number]) => {
    if (!active) return;
    if (pointCount >= MAX_POINTS) { notice(t`画作已达到笔迹上限，请保存或导出。`); finishStroke(); return; }
    const quantized=quantizePoint(value),added=JSON.stringify(quantized).length+(active.points.length?1:0);
    if(usedChars+added>MAX_ARTWORK_CHARS){
      if(!active.points.length){drawing.strokes.pop();usedChars=JSON.stringify(drawing).length;}
      finishStroke();updateBudget();notice(t`画作已达到保存容量，请保存、撤销部分笔迹或导出 PNG。`);return;
    }
    active.points.push(quantized);usedChars+=added;updateBudget();pointCount++;dirty=true;
    options.onStrokePoint?.(value);
    renderStrokePoint(canvas, active, active.points.length - 1); changed();
  };
  const animate = (time: number) => {
    if (!active || closed) return;
    const elapsed = Math.max(0, Math.min((time - lastTime) / 1000, .1)); lastTime = time;
    if (tool === 'spray') {
      const ticks = sprayTicks(elapsed, remainder); remainder = ticks.remainder;
      for (let index = 0; index < ticks.count && active; index++) append([...target]);
    } else if (tool === 'steady') {
      filtered = steadyPoint(filtered, target, elapsed);
      const previous = active.points.at(-1)!;
      if (Math.hypot((filtered[0] - previous[0]) * canvas.width, (filtered[1] - previous[1]) * canvas.height) > .3) append([...filtered]);
    }
    if (active) frame = requestAnimationFrame(animate);
  };
  canvas.addEventListener('pointerdown', event => {
    if (saving || options.savePending?.() || pointer !== undefined || event.button !== 0) return;
    event.preventDefault(); canvas.focus();
    if (drawing.strokes.length >= MAX_STROKES) { notice(t`笔画已达上限，请保存后开始新画。`); return; }
    remember(); target = point(event); filtered = [...target]; pointer = event.pointerId; canvas.setPointerCapture(pointer);
    active = { color: color.value, width: Number(width.value), tool, points: [], ...(tool === 'spray' ? { seed: crypto.getRandomValues(new Uint32Array(1))[0] } : {}) };
    drawing.strokes.push(active);usedChars=JSON.stringify(drawing).length;append([...target]); remainder = 0; lastTime = performance.now();
    frame = requestAnimationFrame(animate);
  }, { signal });
  canvas.addEventListener('pointermove', event => {
    if (!active || pointer !== event.pointerId) return;
    event.preventDefault(); target = point(event);
    if (tool === 'brush') for (const sample of event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event]) append(point(sample));
  }, { signal });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) canvas.addEventListener(name, event => { if (pointer === event.pointerId) finishStroke(); }, { signal });
  window.addEventListener('blur', finishStroke, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) finishStroke(); }, { signal });
  const selectTool = (kind: BrushKind) => {
    finishStroke(); toolWidths[tool] = Number(width.value); tool = kind;
    width.value = String(toolWidths[tool]); host.querySelector<HTMLOutputElement>('.painting-size output')!.value = width.value;
    host.querySelectorAll<HTMLButtonElement>('[data-brush]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.brush === kind)));
    host.querySelector('.painting-tool-help')!.textContent = { brush: t`圆头画笔，随手画下眼前的风景。`, spray: t`按住持续喷涂，停留越久颜色越密。`, steady: t`笔尖平滑跟随，慢慢描出细节。` }[kind];
  };
  const palette = host.querySelector('.painting-palette')!;
  for (const [index, value] of PALETTE.entries()) {
    const swatch = document.createElement('button'); swatch.type = 'button'; swatch.style.setProperty('--swatch', value);
    swatch.setAttribute('aria-label', t`颜色 ${index + 1} ${value}`); swatch.title = t`颜色 ${index + 1}`; swatch.setAttribute('aria-pressed', String(value === color.value));
    swatch.onclick = () => { color.value = value; color.dispatchEvent(new Event('input')); };
    palette.append(swatch);
  }
  color.addEventListener('input', () => {
    palette.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.style.getPropertyValue('--swatch') === color.value)));
    host.querySelector('.painting-color-value')!.textContent = color.value.toUpperCase();
  }, { signal });
  width.addEventListener('input', () => { host.querySelector<HTMLOutputElement>('.painting-size output')!.value = width.value; }, { signal });
  canvas.addEventListener('wheel', event => { event.preventDefault(); width.value = String(Math.min(100, Math.max(2, Number(width.value) - Math.sign(event.deltaY) * 2))); width.dispatchEvent(new Event('input')); }, { passive: false, signal });
  host.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || saving) return;
    if (button.dataset.brush) { selectTool(button.dataset.brush as BrushKind); return; }
    const action = button.dataset.draw;
    if (!action) return;
    if (options.savePending?.() && !['save', 'export', 'close'].includes(action)) return;
    finishStroke();
    if (action === 'close') close();
    if (action === 'undo') { drawing = history.pop() ?? drawing; pointCount = drawing.strokes.reduce((count, stroke) => count + stroke.points.length, 0); dirty = true; redraw(); persistDraft(); }
    if (action === 'clear') { remember(); drawing = { ...drawing, strokes: [] }; pointCount = 0; dirty = true; redraw(); persistDraft(); }
    if (action === 'export') exportPng();
    if (action === 'save') {
      saving = true; host.setAttribute('aria-busy', 'true'); host.querySelectorAll<HTMLButtonElement>('button').forEach(control => { control.disabled = true; });
      Promise.resolve().then(() => options.onSave(parseDrawing(JSON.stringify(drawing)))).then(result => {
        if (closed) return;
        dirty = false;
        if (!result) { close(true); return; }
        drawing = parseDrawing(JSON.stringify(result.next)); history.length = 0;
        pointCount = drawing.strokes.reduce((count, stroke) => count + stroke.points.length, 0);
        redraw(); notice(result.notice);
      }).catch(error => { notice(t`保存失败：${String(error)}，画作仍保留在画板上。`); }).finally(() => {
        saving = false;
        if (!closed) {
          host.removeAttribute('aria-busy'); const pending = !!options.savePending?.();
          host.querySelectorAll<HTMLButtonElement>('button').forEach(control => { control.disabled = pending && !['save', 'export', 'close'].includes(control.dataset.draw ?? ''); });
          undo.disabled = pending || history.length === 0;
        }
      });
    }
  }, { signal });
  window.addEventListener('keydown', event => {
    if (closed) return;
    if (document.querySelector('dialog[open]')) return;
    // Capture input before the world gets tool digits, WASD, flight, or Escape.
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    const editing = (event.target as HTMLElement).matches('input,textarea,select');
    if (!editing && ['Digit1','Digit2','Digit3'].includes(event.code)) { event.preventDefault(); selectTool(({ Digit1: 'brush', Digit2: 'spray', Digit3: 'steady' } as const)[event.code as 'Digit1']); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !editing) { event.preventDefault(); undo.click(); }
    if (event.key === 'Tab') {
      const controls = [...host.querySelectorAll<HTMLElement>('button:not(:disabled),input,canvas[tabindex]')], first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, { capture: true, signal });
  window.addEventListener('keyup', event => { if (!document.querySelector('dialog[open]')) event.stopImmediatePropagation(); }, { capture: true, signal });
  redraw(); mount.classList.add('painting-active'); host.querySelector<HTMLButtonElement>('[data-draw=close]')!.focus();
  return (force = false) => close(force);
}
