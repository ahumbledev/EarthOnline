import type * as THREE from 'three';

/** A failed scene load or cached-view return must preserve the shared renderer. */
export function rendererPolicy(renderer: THREE.WebGLRenderer) {
  const settings = { outputColorSpace: renderer.outputColorSpace, toneMapping: renderer.toneMapping,
    toneMappingExposure: renderer.toneMappingExposure, transmissionResolutionScale: renderer.transmissionResolutionScale };
  const shadows = { enabled: renderer.shadowMap.enabled, type: renderer.shadowMap.type, autoUpdate: renderer.shadowMap.autoUpdate };
  const autoReset = renderer.info.autoReset;
  return () => { Object.assign(renderer, settings); Object.assign(renderer.shadowMap, shadows); renderer.info.autoReset = autoReset; };
}
