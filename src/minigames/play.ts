import * as THREE from 'three';
import { createMinigamesView } from './index.ts';

export function mountChallenges(container: HTMLElement, exit: () => void) {
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  const view = createMinigamesView({container, renderer, exit});
  let closed = false;
  function resize() {
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    view.resize();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  view.activate();
  resize();
  void view.ready.catch(error => {
    if (closed) return;
    const status = container.querySelector('.mg-feedback');
    if (status) status.textContent = String(error);
  });
  const title = 'EarthOnline · 城市探索';
  renderer.setAnimationLoop(now => view.render(now));
  return () => {
    closed = true;
    observer.disconnect();
    renderer.setAnimationLoop(null);
    view.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    document.title = title;
  };
}
