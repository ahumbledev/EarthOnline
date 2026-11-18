import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createLook } from './look.ts';
import { buildCup, buildGrinder, buildMachine, buildMilk, buildPitcher, buildPortafilter, buildSteamWand, buildWaterTap, printed, put, rbox } from './models.ts';
import { BASKET, recipes, scoreCup, volume, yieldOf, type Cup } from './rules.ts';
import './practice.css';

type Control = 'grind' | 'water' | 'milk' | 'steam' | 'pour';
const names = { espresso: '浓缩', water: '热水', milk: '牛奶', foam: '奶泡' };

export function mountCoffee(host: HTMLElement, onExit: () => void): () => void {
  const root = document.createElement('section');
  root.className = 'coffee-practice';
  root.innerHTML = `<header><h2>咖啡练习台</h2><button data-exit>返回城市</button></header>
    <div class="coffee-view"></div><div class="coffee-controls"><label>练习配方 <select></select></label>
    <p data-goal></p><p data-level></p><div class="coffee-buttons">
    <button data-hold="grind">按住磨粉</button><button data-brew>开始萃取</button>
    <button data-hold="water">按住加热水</button><button data-hold="milk">按住往奶缸加奶</button>
    <button data-hold="steam">按住蒸奶打泡</button><button data-hold="pour">按住倒奶</button>
    <button data-score>品评</button><button data-reset>换个空杯</button></div>
    <output aria-live="polite">先磨粉，9 克咖啡粉约出 30 毫升浓缩。</output></div>`;
  host.replaceChildren(root);
  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const select = q<HTMLSelectElement>('select'), goal = q('[data-goal]'), level = q('[data-level]');
  const stage = q('.coffee-view'), message = q('output');
  recipes.forEach((recipe, index) => select.add(new Option(recipe.name, String(index))));
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  stage.append(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, .03, 16);
  scene.background = new THREE.Color(0xc4a787);
  const environment = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
  const lighting = pmrem.fromScene(environment); scene.environment = lighting.texture;
  environment.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xfff4df, 0xa18b82, 2));
  const sun = new THREE.DirectionalLight(0xffead5, 2); sun.position.set(-1.5, 2, 3); scene.add(sun);
  const look = createLook(Math.min(4, renderer.capabilities.getMaxAnisotropy()));
  const machine = buildMachine(look, [0]);
  put(machine.group, scene); put(buildGrinder(look), scene, -.58);
  put(buildSteamWand(look), scene, .27); put(buildWaterTap(look), scene, -.28);
  put(buildMilk(look), scene, .61, 0, -.02);
  const pitcher = buildPitcher(look); put(pitcher.group, scene, .35, 0, .23);
  const port = buildPortafilter(look); put(port.group, scene, -.58, .115, .1);
  const surface = rbox(1.85, .09, .9, look.mats.marble(1.85, .9)); put(surface, scene, 0, -.05);
  const wrap = printed(96, 96, (ctx, w, h) => {
    ctx.fillStyle = '#eae1ca'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#4c7167'; ctx.fillRect(0, h * .28, w, h * .38);
  });
  let shape = buildCup(look, 'demi', wrap);
  put(shape.group, scene, 0, .095, .054);
  const liquid = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshStandardMaterial({ color: 0x553019 }));
  liquid.rotation.x = -Math.PI / 2; scene.add(liquid);
  let grounds = 0, readyMl = 0, brewed = false, milk = 0, foam = 0, heat = 0;
  let cup: Cup = { kind: 'demi', fills: {}, hot: 0, drawn: false };
  let hold: Control | undefined, frame = 0, previous = performance.now();
  function reset() {
    const recipe = recipes[select.selectedIndex]; cup = { kind: recipe.kind, fills: {}, hot: 0, drawn: false };
    grounds = readyMl = milk = foam = heat = 0; brewed = false; hold = undefined;
    // Reuse one cup mesh; the public menu only needs two sizes.
    shape.group.scale.setScalar(recipe.kind === 'demi' ? 1 : 1.35);
    port.group.position.set(-.58, .115, .1);
    goal.textContent = '目标配比　' + Object.entries(recipe.parts(recipe.kind)).map(([id, amount]) => names[id as keyof typeof names] + ' ' + amount + ' ml').join(' · ');
    message.textContent = '先磨粉，到目标克数时松手。';
  }
  const capacity = () => cup.kind === 'demi' ? 100 : 236;
  const space = () => Math.max(0, capacity() - volume(cup.fills));
  function tick(dt: number) {
    if (hold === 'grind' && !brewed) grounds = Math.min(BASKET, grounds + 4.5 * dt);
    if (hold === 'water') cup.fills.water = (cup.fills.water ?? 0) + Math.min(space(), 55 * dt);
    if (hold === 'milk') milk += Math.min(600 - milk - foam, 70 * dt);
    if (hold === 'steam' && milk + foam >= 20) {
      const dairy = milk + foam;
      if (heat < dairy * .95) heat = Math.min(dairy, heat + dairy * dt / 3);
      else { const moved = Math.min(milk, dairy * .12 * dt); milk -= moved; foam += moved; }
    }
    if (hold === 'pour' && milk + foam > 0) {
      const dairy = milk + foam, amount = Math.min(dairy, space(), 60 * dt), ratio = amount / dairy;
      const movedFoam = foam * ratio;
      cup.fills.milk = (cup.fills.milk ?? 0) + amount - movedFoam;
      cup.fills.foam = (cup.fills.foam ?? 0) + movedFoam;
      milk *= 1 - ratio; foam *= 1 - ratio; heat *= 1 - ratio;
    }
    if (readyMl > 0) {
      const amount = Math.min(readyMl, 5 * dt); readyMl -= amount;
      cup.fills.espresso = (cup.fills.espresso ?? 0) + Math.min(space(), amount);
      machine.gauges.pump(9); machine.gauges.boiler(1.2);
    } else { machine.gauges.pump(0); machine.gauges.boiler(.8); }
    port.puck.visible = grounds > .5; port.puck.scale.y = .3 + grounds / BASKET;
    const fill = volume(cup.fills) / capacity(), scale = shape.group.scale.x;
    liquid.visible = fill > .002; liquid.scale.setScalar((shape.inner + (shape.radius - shape.inner) * fill) * scale * .94);
    liquid.position.set(0, .1 + shape.height * scale * fill, .054);
    const milkFraction = ((cup.fills.milk ?? 0) + (cup.fills.foam ?? 0)) / Math.max(1, volume(cup.fills));
    liquid.material.color.setRGB(.12 + milkFraction * .62, .055 + milkFraction * .5, .025 + milkFraction * .4);
    level.textContent = '粉篮 ' + grounds.toFixed(1) + ' g　奶缸 ' + Math.round(milk + foam) + ' ml（奶泡 ' + Math.round(foam) + ' ml）　杯中 ' +
      Object.entries(cup.fills).filter(([, n]) => n > .1).map(([id,n]) => names[id as keyof typeof names] + ' ' + Math.round(n) + ' ml').join(' / ');
  }
  for (const element of root.querySelectorAll<HTMLButtonElement>('[data-hold]')) {
    const start = () => { hold = element.dataset.hold as Control; message.textContent = '松手停止。'; };
    element.onpointerdown = e => { if (e.button !== 0) return; element.setPointerCapture(e.pointerId); start(); };
    element.onpointerup = element.onpointercancel = element.onlostpointercapture = () => { hold = undefined; };
    element.onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); start(); } };
    element.onkeyup = element.onblur = () => { hold = undefined; };
  }
  q('[data-brew]').onclick = () => {
    if (brewed || grounds <= 0) { message.textContent = brewed ? '这份咖啡粉已萃取。可品评或换空杯。' : '先按住磨粉。'; return; }
    brewed = true; readyMl = yieldOf(grounds); port.group.position.copy(machine.heads[0].lock);
    message.textContent = '正在萃取，流速 5 ml/s。';
  };
  q('[data-score]').onclick = () => {
    const recipe = recipes[select.selectedIndex];
    message.textContent = '本杯得分 ' + scoreCup(cup, recipe, recipe.kind) + ' / 100。';
  };
  q('[data-exit]').onclick = onExit; q('[data-reset]').onclick = reset; select.onchange = reset;
  function resize() {
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h, false); camera.aspect = w / h;
    const distance = Math.max(1.32, 2.43 / camera.aspect);
    camera.position.set(.22, .24 + distance * .52, distance); camera.lookAt(0, .21, 0); camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize); observer.observe(stage); resize(); reset();
  const pause = () => { hold = undefined; previous = performance.now(); };
  window.addEventListener('blur', pause); document.addEventListener('visibilitychange', pause);
  function update(now: number) {
    tick(document.hidden ? 0 : Math.min(.12, (now - previous) / 1000)); previous = now;
    renderer.render(scene, camera); frame = requestAnimationFrame(update);
  }
  frame = requestAnimationFrame(update);
  return () => {
    cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('blur', pause); document.removeEventListener('visibilitychange', pause);
    scene.traverse(obj => { if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose(); for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        for (const map of Object.values(mat)) if (map instanceof THREE.Texture) map.dispose(); mat.dispose();
      }
    } });
    wrap.dispose(); lighting.dispose(); renderer.dispose(); root.remove();
  };
}
