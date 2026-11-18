import { createActivityControls, isPlainActivityKey } from '../common/controls.ts';
import { createActivityPanel } from '../common/panel.ts';
import * as THREE from 'three';
import type { GameView, GameViewContext } from '../view.ts';
import { createRamenState, startRamen, advanceRamen, foldRamen, FOLD_MIN, FOLD_MAX, type RamenNotice } from './game.ts';
import { createRamenScene } from './scene.ts';
import './style.css';
import { t } from '../language.ts';

const notices: Record<RamenNotice, string> = {
  ready: t`一团面，拉出今天的第一碗。`, knead: t`按住揉面，让面团变得柔软。`,
  pull: t`按住拉伸；进入绿色区域后松手，再对折。`, 'too-short': t`面还不够长，再拉开一点。`,
  'too-long': t`拉得太长了，松手让面慢慢回缩。`, relax: t`面绷得太紧，松手等待张力下降。`,
  folded: t`对折完成，面条又细了一倍。`, served: t`一碗新鲜手拉面，完成！`,
  torn: t`面条拉断了。下次拉一会儿、松一会儿。`, timeout: t`这次时间到了，再试一碗吧。`,
};

export function createRamenView(context: GameViewContext, onExit: () => Promise<void> | void): GameView {
  const { renderer, container } = context;
  const root = document.createElement('section'); root.className = 'ramen-view'; root.dataset.ramenStage = 'ready';
  root.setAttribute('aria-label', t`手拉面工坊`);
  root.innerHTML = `
    <div class="ramen-stage" data-ramen-canvas></div>
    <header class="ramen-header"><button type="button" class="ramen-back" data-ramen-action="exit">← ${t`返回场所`}</button><div><h1 data-ramen-title></h1></div><button type="button" class="ramen-pause" data-ramen-action="pause">${t`暂停`}</button></header>
    <div class="ramen-status"><span data-ramen-step>${t`准备开工`}</span><strong data-ramen-time></strong></div>
    <div class="ramen-controls">
      <div class="ramen-control-heading"><div><span class="ramen-eyebrow" data-ramen-folds></span><h2 data-ramen-instruction></h2></div><strong class="ramen-score" data-ramen-score hidden></strong></div>
      <div class="ramen-meters" data-ramen-meters>
        <label class="ramen-meter"><span data-ramen-length-label>${t`揉面`}</span><div class="ramen-track"><div class="ramen-fold-window" data-ramen-fold-window></div><div class="ramen-fill" data-ramen-length></div></div><output data-ramen-length-value>0%</output></label>
        <label class="ramen-meter"><span>${t`张力`}</span><div class="ramen-track"><div class="ramen-fill ramen-tension" data-ramen-tension></div></div><output data-ramen-tension-value>0%</output></label>
      </div>
      <div class="ramen-buttons">
        <button type="button" class="ramen-primary" data-ramen-action="start">${t`开始揉面`}</button>
        <button type="button" class="ramen-primary" data-ramen-action="knead" hidden>${t`按住揉面`} <kbd>K</kbd></button>
        <button type="button" class="ramen-primary" data-ramen-action="pull" hidden>${t`按住拉伸`} <kbd>${t`空格`}</kbd></button>
        <button type="button" data-ramen-action="fold" hidden>${t`对折`} <kbd>F</kbd></button>
        <button type="button" class="ramen-primary" data-ramen-action="replay" hidden>${t`再做一碗`}</button>
      </div>
      <p class="ramen-hint" data-ramen-hint>${t`拉伸到绿色区间，松手放松面筋，再对折。`}</p>
    </div>
    <div class="ramen-paused" data-ramen-paused hidden><div><span class="ramen-eyebrow">${t`歇一会儿`}</span><h2>${t`面团在等你`}</h2><p>${t`休息时不计时。`}</p><button type="button" class="ramen-primary" data-ramen-action="resume">${t`继续手作`}</button></div></div>
    <p class="ramen-asset-notice" data-ramen-assets role="status" hidden></p>
    <span class="ramen-sr" data-ramen-announcement role="status" aria-live="polite"></span>`;
  container.append(root);
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const action = (name: string) => get<HTMLButtonElement>(`[data-ramen-action="${name}"]`);
  const stage = get('[data-ramen-canvas]');
  get('[data-ramen-title]').textContent = t`手拉面工坊`;
  let state = createRamenState(), active = false, disposed = false, paused = false;
  let lastFrame = 0, lastHud = 0, localSeconds = 0, exiting = false, lastNotice = '';
  let primaryHeld = false;
  const heldKeys = new Set<string>(), pointers = new Map<number, string>();
  const abort = new AbortController(), eventOptions = { signal: abort.signal };
  const world = createRamenScene();
  let rendererState: { toneMapping: THREE.ToneMapping; exposure: number; autoClear: boolean; shadows: boolean; shadowType: THREE.ShadowMapType; shadowAutoUpdate: boolean } | null = null;
  const acceptsInput = () => active && !disposed && !container.inert && !document.hidden;
  const isHeld = (name: 'pull' | 'knead') => (name === 'pull' ? heldKeys.has('Space') : heldKeys.has('KeyK')) || [...pointers.values()].includes(name) || primaryHeld && (name === 'knead' ? state.stage === 'kneading' : state.stage === 'pulling');
  const clearInput = () => {
    primaryHeld = false; heldKeys.clear(); pointers.clear();
    for (const name of ['knead', 'pull']) action(name).classList.remove('is-held');
  };
  const panel = createActivityPanel({ onOpen: pause, onClose: resume });
  function showMenu() { panel.open(t`手拉面工坊`, [t`休息时不计时。`, t`E 按住揉面或拉伸，F 对折，B 操作帮助，R 当前工序。`], [{ text: t`返回场所`, run: () => { void onExit(); } }]); }
  const controls = createActivityControls({ active: acceptsInput, blocked: () => exiting,
    pause: showMenu, book: () => panel.open(t`操作帮助`, [notices.knead, notices.pull, t`E 按住揉面或拉伸，F 对折，B 操作帮助，R 当前工序。`]),
    task: () => panel.open(t`当前工序`, [notices[state.notice], t`完成对折 ${state.folds} 次`]),
    primaryDown() { if (paused) return; if (state.stage === 'ready') state = startRamen(state); primaryHeld = true; refresh(); },
    primaryUp() { primaryHeld = false; refresh(); }, suspend: clearInput,
  });
  function pause() { if (!active) return; paused = true; clearInput(); lastFrame = 0; refresh(); }
  function resume() { if (!acceptsInput()) return; paused = false; clearInput(); lastFrame = performance.now(); refresh(); }
  function refresh() {
    root.dataset.ramenStage = state.stage; root.dataset.ramenPaused = String(paused);
    root.dataset.ramenLength = state.length.toFixed(4); root.dataset.ramenTension = state.tension.toFixed(4);
    root.dataset.ramenFolds = String(state.folds); root.dataset.ramenRemaining = state.remaining.toFixed(2);
    root.dataset.ramenNotice = state.notice;
    const kneading = state.stage === 'kneading', pulling = state.stage === 'pulling', done = state.stage === 'won' || state.stage === 'failed';
    get('[data-ramen-step]').textContent = state.stage === 'ready' ? t`一团面 · 一碗热气` : kneading ? t`01 / 揉面` : pulling ? t`02 / 拉伸与对折` : state.stage === 'won' ? t`03 / 出餐` : t`再试一次`;
    get('[data-ramen-time]').textContent = t`${Math.ceil(state.remaining)} 秒`;
    get('[data-ramen-folds]').textContent = t`第 ${Math.min(state.folds + 1, state.config.targetFolds)} 折 / 共 ${state.config.targetFolds} 折 · ${2 ** state.folds} 根面`;
    get('[data-ramen-instruction]').textContent = notices[state.notice];
    const score = get('[data-ramen-score]'); score.hidden = state.stage !== 'won'; score.textContent = t`${Math.round(state.quality)} 分`;
    get('[data-ramen-meters]').hidden = state.stage === 'ready' || done;
    get('[data-ramen-length-label]').textContent = kneading ? t`揉面` : t`长度`;
    const lengthPercent = Math.round((kneading ? state.kneaded : state.length) * 100);
    const tensionPercent = Math.round(state.tension / state.config.tearThreshold * 100);
    get('[data-ramen-length]').style.width = `${Math.min(100, lengthPercent)}%`;
    get('[data-ramen-length-value]').textContent = `${lengthPercent}%`;
    get('[data-ramen-tension]').style.width = `${tensionPercent}%`;
    get('[data-ramen-tension]').classList.toggle('is-danger', tensionPercent > 72);
    get('[data-ramen-tension-value]').textContent = `${tensionPercent}%`;
    get('[data-ramen-fold-window]').hidden = !pulling;
    action('start').hidden = state.stage !== 'ready'; action('knead').hidden = !kneading;
    action('pull').hidden = !pulling; action('fold').hidden = !pulling; action('replay').hidden = !done;
    action('fold').classList.toggle('is-ready', pulling && state.length >= FOLD_MIN && state.length <= FOLD_MAX && state.tension <= state.config.tearThreshold * .72);
    action('pause').hidden = done || state.stage === 'ready'; action('pause').disabled = paused;
    action('knead').classList.toggle('is-held', isHeld('knead')); action('pull').classList.toggle('is-held', isHeld('pull'));
    get('[data-ramen-paused]').hidden = !paused;
    get('[data-ramen-hint]').textContent = done ? t`本次为手作练习，成品与评分保留在本次试玩。` : kneading ? t`按住按钮或 K 键，直到面团准备好。` : t`拉伸到绿色区间（60–85%），松手让张力低于 72%，再对折。`;
    if (state.notice !== lastNotice) { lastNotice = state.notice; get('[data-ramen-announcement]').textContent = notices[state.notice]; }
  }
  async function exit() {
    if (!acceptsInput() || exiting) return; exiting = true; clearInput(); action('exit').disabled = true;
    try { await onExit(); } catch {
      if (!disposed) { const notice = get('[data-ramen-assets]'); notice.hidden = false; notice.textContent = t`暂时无法返回，请再试一次。`; }
    } finally { if (!disposed) { exiting = false; action('exit').disabled = false; } }
  }
  root.addEventListener('click', event => {
    const target = (event.target as Element).closest<HTMLElement>('[data-ramen-action]');
    if (!target || !acceptsInput()) return;
    const name = target.dataset.ramenAction;
    if (name === 'exit') { void exit(); return; }
    if (name === 'resume') { resume(); return; }
    if (name === 'pause') { showMenu(); return; }
    if (paused) return;
    if (name === 'start') state = startRamen(state);
    if (name === 'replay') { state = startRamen(createRamenState()); localSeconds = 0; clearInput(); }
    if (name === 'fold') state = foldRamen(state);
    refresh();
  }, eventOptions);
  root.addEventListener('pointerdown', event => {
    const target = (event.target as Element).closest<HTMLButtonElement>('[data-ramen-action]');
    const name = target?.dataset.ramenAction;
    if (!acceptsInput() || paused || !target || (name !== 'pull' && name !== 'knead') || event.button !== 0) return;
    event.preventDefault(); target.focus(); target.setPointerCapture(event.pointerId); pointers.set(event.pointerId, name); refresh();
  }, eventOptions);
  const releasePointer = (event: PointerEvent) => { pointers.delete(event.pointerId); if (!disposed) refresh(); };
  window.addEventListener('pointerup', releasePointer, eventOptions);
  window.addEventListener('pointercancel', releasePointer, eventOptions);
  root.addEventListener('lostpointercapture', releasePointer, eventOptions);
  window.addEventListener('keydown', event => {
    if (!acceptsInput() || !isPlainActivityKey(event) || document.querySelector('dialog[open]') || event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) return;

    if (paused || !['KeyK', 'Space', 'KeyF'].includes(event.code)) return;
    // Space on a focused native button must retain its normal click behavior outside the pull phase.
    if (event.code === 'Space' && state.stage !== 'pulling') return;
    event.preventDefault(); heldKeys.add(event.code);
    if (event.code === 'KeyF' && !event.repeat) state = foldRamen(state);
    refresh();
  }, eventOptions);
  window.addEventListener('keyup', event => { heldKeys.delete(event.code); if (!disposed) refresh(); }, eventOptions);
  window.addEventListener('blur', pause, eventOptions);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); }, eventOptions);
  document.addEventListener('focusin', event => { if (active && event.target instanceof Node && !root.contains(event.target)) pause(); }, eventOptions);
  refresh(); world.update(state, 0, false);
  if (context.quality) world.setQuality(context.quality);
  function restoreRenderer() {
    if (!rendererState) return;
    renderer.toneMapping = rendererState.toneMapping; renderer.toneMappingExposure = rendererState.exposure;
    renderer.autoClear = rendererState.autoClear; renderer.shadowMap.enabled = rendererState.shadows;
    renderer.shadowMap.type = rendererState.shadowType; renderer.shadowMap.autoUpdate = rendererState.shadowAutoUpdate; rendererState = null;
  }
  return {
    // Pausing this practice round does not pause the shared city clock.
    
    activate() {
      if (disposed || active) return; active = true; root.hidden = false; stage.append(renderer.domElement);
      rendererState = { toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, autoClear: renderer.autoClear,
        shadows: renderer.shadowMap.enabled, shadowType: renderer.shadowMap.type, shadowAutoUpdate: renderer.shadowMap.autoUpdate };
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
      renderer.autoClear = true; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = true;
      lastFrame = performance.now(); clearInput(); refresh();
    },
    deactivate() { panel.close(false); controls.suspend(); active = false; root.hidden = true; clearInput(); lastFrame = 0; restoreRenderer(); },
    render(now) {
      if (!active || disposed) return;
      const delta = lastFrame ? Math.max(0, (now - lastFrame) / 1000) : 0; lastFrame = now;
      if (!paused && !document.hidden && !container.inert && !exiting) {
        const before = state.stage;
        state = advanceRamen(state, { deltaSeconds: delta, knead: isHeld('knead'), pull: isHeld('pull') });
        if (Number.isFinite(delta) && delta <= .25) localSeconds += delta;
        if (before !== state.stage) clearInput();
      }
      if (now - lastHud >= 50) { refresh(); lastHud = now; }
      world.update(state, localSeconds, isHeld('knead')); renderer.render(world.scene, world.camera);
    },
    resize(width, height) { world.resize(width, height); }, setQuality: world.setQuality,
    dispose() { if (disposed) return; active = false; disposed = true; clearInput(); restoreRenderer(); controls.dispose(); panel.dispose(); abort.abort(); world.dispose(); root.remove(); },
  };
}
