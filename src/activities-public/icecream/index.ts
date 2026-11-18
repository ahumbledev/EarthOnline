import { createActivityControls, isPlainActivityKey } from '../common/controls.ts';
import { createActivityPanel } from '../common/panel.ts';
import * as THREE from 'three';
import {
  DEFAULT_ICECREAM_CONFIG, applyIcecreamAction, createIcecreamState, icecreamIntegrity, icecreamMeltFraction,
  icecreamPlacementOffset, tickIcecreamState, type IcecreamAction, type IcecreamState,
} from './rules.ts';
import type { GameView, GameViewContext } from '../view.ts';
import { createIcecreamScene } from './scene.ts';
import './style.css';
import { t, td } from '../language.ts';

const names: Record<string, string> = {
  vanilla: t`香草`, strawberry: t`草莓`, chocolate: t`巧克力`, matcha: t`抹茶`, mango: t`芒果`, mint: t`薄荷`,
  sprinkles: t`彩糖`, cookie: t`饼干`, nuts: t`坚果`, caramel: t`焦糖`, cup: t`纸杯`, cone: t`甜筒`,
};
const label = (id: string) => names[id] ?? id;
const failures = { timeout: t`客人等太久了，这一单结束。`, melted: t`冰激凌融化了，再接一单吧。`, toppled: t`放得太偏，冰激凌倒下了。`, wasted: t`连续三次没有挖成，再练习一单吧。` };

export function createIcecreamView(context: GameViewContext, onExit: () => void): GameView {
  const config = DEFAULT_ICECREAM_CONFIG;
  const { container, renderer } = context;
  const root = document.createElement('section'); root.className = 'icecream-view'; root.hidden = true;
  root.setAttribute('aria-label', t`冰激凌工坊`);
  root.innerHTML = `
    <div class="icecream-canvas" data-icecream-canvas></div>
    <header class="icecream-header"><button type="button" data-icecream-action="exit">← ${t`返回场所`}</button><div><span class="icecream-eyebrow">${t`一球一球，认真做好`}</span><h1 data-icecream-title></h1></div><button type="button" data-icecream-menu>${t`菜单 · Esc`}</button></header>
    <aside class="icecream-order"><span class="icecream-eyebrow" data-icecream-order-number>${t`今日第一单`}</span><h2 data-icecream-order-container></h2><ol data-icecream-order-flavors></ol><p data-icecream-order-topping></p><div class="icecream-time"><span>${t`剩余时间`}</span><strong data-icecream-time></strong></div><p data-icecream-melt></p></aside>
    <section class="icecream-controls" aria-label="${t`制作台`}"><h2 data-icecream-instruction></h2>
      <div class="icecream-choices" data-icecream-containers><button type="button" data-icecream-container="cup">${t`纸杯`}</button><button type="button" data-icecream-container="cone">${t`甜筒`}</button></div>
      <div class="icecream-choices" data-icecream-flavors aria-label="${t`选择口味`}"></div>
      <div class="icecream-choices" data-icecream-toppings aria-label="${t`选择配料`}"></div>
      <div class="icecream-meter" data-icecream-meter role="progressbar" aria-label="${t`挖球力度`}" aria-valuemin="0" aria-valuemax="100" hidden><span class="icecream-meter-target"></span><span class="icecream-meter-indicator" data-icecream-indicator></span></div>
      <div class="icecream-result" data-icecream-result hidden><strong class="icecream-score" data-icecream-score></strong><p data-icecream-grades></p></div>
      <div class="icecream-buttons"><button type="button" class="icecream-primary" data-icecream-action="start">${t`接这一单`}</button><button type="button" class="icecream-primary" data-icecream-action="scoop-start" hidden>${t`开始挖球`} <kbd>${t`空格`}</kbd></button><button type="button" class="icecream-primary" data-icecream-action="scoop-release" hidden>${t`收勺`} <kbd>${t`空格`}</kbd></button><button type="button" class="icecream-primary" data-icecream-action="place" hidden>${t`放下这一球`} <kbd>E</kbd></button><button type="button" class="icecream-primary" data-icecream-action="serve" hidden>${t`交给客人`}</button><button type="button" class="icecream-primary" data-icecream-action="replay" hidden>${t`再接一单`}</button></div>
      <p class="icecream-hint" data-icecream-hint></p><p class="icecream-error" data-icecream-error role="status" hidden></p>
    </section><p class="icecream-notice" data-icecream-asset-notice role="status" hidden></p>`;
  container.append(root);
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const button = (action: string) => get<HTMLButtonElement>(`[data-icecream-action="${action}"]`);
  const stage = get('[data-icecream-canvas]'), meter = get('[data-icecream-meter]');
  button('exit').textContent = `← ${t`返回场所`}`;
  get('[data-icecream-title]').textContent = t`冰激凌工坊`;
  for (const [values, selector, key] of [[config.flavors, '[data-icecream-flavors]', 'icecreamFlavor'], [config.toppings, '[data-icecream-toppings]', 'icecreamTopping']] as const) {
    for (const value of values) {
      const option = document.createElement('button'); option.type = 'button'; option.textContent = label(value);
      option.dataset[key] = value; get(selector).append(option);
    }
  }
  let state = createIcecreamState(config, Date.now()), active = false, disposed = false, sending = false, exiting = false;
  let previousOrder = '', lastHud = 0;
  const abort = new AbortController();
  const world = createIcecreamScene(config);
  let rendererState: { toneMapping: THREE.ToneMapping; exposure: number; autoClear: boolean; shadows: boolean; shadowType: THREE.ShadowMapType; shadowAutoUpdate: boolean } | null = null;
  const acceptsInput = () => active && !disposed && !container.inert && !document.hidden && !exiting;
  const me = 'cook';
  const panel = createActivityPanel({});
  function showMenu() { panel.open(t`冰激凌工坊`, [t`本地练习`, t`E 挖球、收勺或放球，B 操作帮助，R 当前订单。`], [{ text: t`返回场所`, run: () => { void exit(); } }]); }
  const controls = createActivityControls({ active: acceptsInput, blocked: () => sending,
    pause: showMenu, book: () => panel.open(t`操作帮助`, [t`到绿色区间时收勺。`, t`对准中间，把这一球稳稳放下。`, t`E 挖球、收勺或放球，B 操作帮助，R 当前订单。`]),
    task: () => panel.open(t`当前订单`, [get('[data-icecream-order-container]').textContent ?? '', get('[data-icecream-order-flavors]').textContent ?? '', get('[data-icecream-order-topping]').textContent ?? '']),
    primaryDown() {
      if (state.pendingScoop) { void send({ type: 'place' }); }
      else if (state.activeScoop) { void send({ type: 'scoop-release' }); }
      else if (state.flavor && state.phase === 'making') { void send({ type: 'scoop-start' }); }
    },
  });
  function readState() {
    const previousPhase = state.phase, previousRound = state.round;
    state = tickIcecreamState(state, config, Date.now());
    if (state.phase !== previousPhase || state.round !== previousRound) setError('');
  }
  const displayNow = Date.now;
  function setError(message: string) { const error = get('[data-icecream-error]'); error.textContent = message; error.hidden = !message; }
  function refresh() {
    const now = displayNow(), making = state.phase === 'making', done = state.phase === 'served' || state.phase === 'failed';
    const complete = state.scoops.length === state.order.flavors.length;
    const usingScoop = !!state.activeScoop, placing = !!state.pendingScoop;
    root.dataset.icecreamPhase = state.phase; root.dataset.icecreamNotice = state.notice;
    root.dataset.icecreamRound = String(state.round); root.dataset.icecreamScoops = String(state.scoops.length);
    root.dataset.icecreamPlacement = icecreamPlacementOffset(state, now).toFixed(3);
    if (state.order.id !== previousOrder) {
      previousOrder = state.order.id;
      get('[data-icecream-order-number]').textContent = t`第 ${state.round} 单`;
      const orderContainer = get('[data-icecream-order-container]'); orderContainer.textContent = t`${label(state.order.container)} · ${state.order.flavors.length} 球`;
      orderContainer.dataset.container = state.order.container;
      const list = get('[data-icecream-order-flavors]'); list.replaceChildren();
      for (const flavor of state.order.flavors) { const li = document.createElement('li'); li.textContent = label(flavor); li.dataset.flavor = flavor; list.append(li); }
      const topping = get('[data-icecream-order-topping]'); topping.textContent = t`配料：${label(state.order.topping)}`; topping.dataset.topping = state.order.topping;
    }
    const stoppedAt = state.result?.servedAt ?? (state.phase === 'failed' ? state.updatedAt : now);
    const remaining = state.startedAt === null ? config.roundSeconds : Math.max(0, config.roundSeconds - (stoppedAt - state.startedAt) / 1000);
    get('[data-icecream-time]').textContent = t`${Math.ceil(remaining)} 秒`;
    get('[data-icecream-melt]').textContent = state.firstPreparedAt === null ? t`挖好第一球后开始融化` : t`完整度 ${Math.round(icecreamIntegrity(state, config, stoppedAt) * 100)}% · 融化 ${Math.round(icecreamMeltFraction(state, config, stoppedAt) * 100)}%`;
    let instruction = t`接一张订单，开始今天的手作。`;
    if (making) instruction = !state.container ? t`先给客人选一个容器。` : usingScoop ? t`到绿色区间时收勺。`
      : placing ? t`对准中间，把这一球稳稳放下。` : !complete ? t`第 ${state.scoops.length + 1} 球，选择一种口味。`
      : !state.topping ? t`最后，加上客人喜欢的配料。` : t`做好了，趁还没融化交给客人。`;
    if (state.phase === 'served') instruction = state.result!.grade === 'excellent' ? t`这一份，做得漂亮。` : state.result!.grade === 'good' ? t`完成了，下次还能更稳。` : t`订单完成，再练习一下搭配和手感。`;
    if (state.phase === 'failed') instruction = failures[state.failure!];
    get('[data-icecream-instruction]').textContent = instruction;
    get('[data-icecream-containers]').hidden = !making || !!state.container;
    get('[data-icecream-flavors]').hidden = !making || !state.container || usingScoop || placing || complete;
    get('[data-icecream-toppings]').hidden = !making || !complete || usingScoop || placing;
    for (const option of root.querySelectorAll<HTMLButtonElement>('[data-icecream-flavor]')) option.setAttribute('aria-pressed', String(option.dataset.icecreamFlavor === state.flavor));
    for (const option of root.querySelectorAll<HTMLButtonElement>('[data-icecream-topping]')) option.setAttribute('aria-pressed', String(option.dataset.icecreamTopping === state.topping));
    meter.hidden = !making || (!usingScoop && !placing); meter.dataset.kind = usingScoop ? 'scoop' : 'place';
    meter.setAttribute('aria-label', usingScoop ? t`挖球力度，绿色区间收勺` : t`勺子位置，中央放下`);
    const percent = usingScoop ? Math.min(100, Math.max(0, (now - state.activeScoop!.startedAt) / 1800 * 100)) : (icecreamPlacementOffset(state, now) + 1) * 50;
    get('[data-icecream-indicator]').style.left = `${percent}%`; meter.setAttribute('aria-valuenow', String(Math.round(percent)));
    button('start').hidden = state.phase !== 'ready';
    button('scoop-start').hidden = !making || !state.flavor || usingScoop || placing || complete;
    button('scoop-release').hidden = !making || !usingScoop;
    button('place').hidden = !making || !placing;
    button('serve').hidden = !making || !complete || !state.topping;
    button('replay').hidden = !done;
    get('[data-icecream-result]').hidden = !state.result;
    if (state.result) {
      get('[data-icecream-score]').textContent = `${state.result.score}`;
      get('[data-icecream-grades]').textContent = t`搭配 ${state.result.match} · 完整 ${state.result.integrity} · 速度 ${state.result.speed}`;
    }
    const hint = t`搭配所示口味与配料。`;
    get('[data-icecream-hint]').textContent = state.notice === 'missed' ? t`这球没挖成（${state.mistakes}/3），绿色区间收勺就会圆一些。`
      : usingScoop ? t`开始后约 0.9 秒收勺；过早会太小，太晚会散掉。` : placing ? t`观察移动的勺子，进入绿色区域后按 E 或点击放下。` : done ? t`本轮已结束。` : hint;
    for (const control of root.querySelectorAll<HTMLButtonElement>('button')) control.disabled = sending || exiting;
    button('exit').disabled = exiting;
  }
  async function send(action: IcecreamAction) {
    if (!acceptsInput() || sending) return;
    sending = true; setError(''); refresh();
    try {
      state = applyIcecreamAction(state, action, { playerId: me, now: Date.now() }, config);
      if (!disposed) readState();
    } catch (error) {
      if (!disposed && !(action.type === 'serve' && state.phase === 'served')) setError(error instanceof Error ? td(error.message) : t`操作没有完成，请重试。`);
    }
    finally { if (!disposed) { sending = false; refresh(); } }
  }
  async function exit() {
    if (!acceptsInput()) return; exiting = true; refresh();
    try { await onExit(); } catch { if (!disposed) setError(t`暂时无法返回，请重试。`); }
    finally { if (!disposed) { exiting = false; refresh(); } }
  }
  root.addEventListener('click', event => {
    const control = (event.target as Element).closest<HTMLButtonElement>('button'); if (!control || !acceptsInput()) return;
    if (control.hasAttribute('data-icecream-menu')) { showMenu(); return; }
    if (control.dataset.icecreamAction === 'exit') { void exit(); return; }
    const action = control.dataset.icecreamAction;
    if (action) { void send({ type: action } as IcecreamAction); return; }
    if (control.dataset.icecreamContainer) void send({ type: 'container', container: control.dataset.icecreamContainer as 'cup' | 'cone' });
    if (control.dataset.icecreamFlavor) void send({ type: 'flavor', flavor: control.dataset.icecreamFlavor });
    if (control.dataset.icecreamTopping) void send({ type: 'topping', topping: control.dataset.icecreamTopping });
  }, { signal: abort.signal });
  window.addEventListener('keydown', event => {
    if (!acceptsInput() || !isPlainActivityKey(event) || document.querySelector('dialog[open]') || sending || event.repeat || event.ctrlKey || event.altKey || event.metaKey ||
      (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) return;
    if (event.code !== 'Space' || state.phase !== 'making') return;
    if (state.activeScoop) { event.preventDefault(); void send({ type: 'scoop-release' }); }
    else if (state.flavor && !state.pendingScoop && !state.activeScoop) { event.preventDefault(); void send({ type: 'scoop-start' }); }
  }, { signal: abort.signal });
  function restoreRenderer() {
    if (!rendererState) return;
    renderer.toneMapping = rendererState.toneMapping; renderer.toneMappingExposure = rendererState.exposure;
    renderer.autoClear = rendererState.autoClear; renderer.shadowMap.enabled = rendererState.shadows;
    renderer.shadowMap.type = rendererState.shadowType; renderer.shadowMap.autoUpdate = rendererState.shadowAutoUpdate; rendererState = null;
  }
  if (context.quality) world.setQuality(context.quality);
  readState(); refresh(); world.update(state, displayNow());
  return {
    
    activate() {
      if (disposed || active) return; active = true; root.hidden = false; stage.append(renderer.domElement);
      rendererState = { toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, autoClear: renderer.autoClear,
        shadows: renderer.shadowMap.enabled, shadowType: renderer.shadowMap.type, shadowAutoUpdate: renderer.shadowMap.autoUpdate };
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1; renderer.autoClear = true;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = true;
      readState(); refresh();
    },
    deactivate() { panel.close(false); controls.suspend(); active = false; root.hidden = true; restoreRenderer(); },
    render(now) {
      if (!active || disposed) return;
      readState();
      if (now - lastHud >= 30) { refresh(); lastHud = now; }
      world.update(state, displayNow()); renderer.render(world.scene, world.camera);
    },
    resize(width, height) {
      const w = Math.max(1, width), h = Math.max(1, height);
      world.camera.aspect = w / h;
      // On a phone the order occupies the left column; keep the actual serving visible beside it.
      if (w / h < .8) world.camera.setViewOffset(w, h, -w * .24, 0, w, h);
      else world.camera.clearViewOffset();
      world.camera.updateProjectionMatrix();
    },
    setQuality(quality) { world.setQuality(quality); },
    dispose() { if (disposed) return; disposed = true; active = false; controls.dispose(); panel.dispose(); abort.abort(); restoreRenderer(); world.dispose(); root.remove(); },
  };
}
