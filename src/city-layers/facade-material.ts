import * as THREE from 'three';
import { FACADE_FRAGMENT, FACADE_LIGHT, FACADE_PARS_FRAGMENT, FACADE_PARS_VERTEX, FACADE_VERTEX } from './facade-shader.ts';
import { sunArcPosition, type Triple } from './core.ts';
import { MAX_PANELS, PANEL_STYLES, type FacadePanelSet } from './panels.ts';
import { createShopSignAtlas, createTallSignAtlas } from './shop-signs.ts';
import { facadeCity } from './cities/index.ts';
import { HONG_KONG } from './cities/hong-kong.ts';
import { sampleTerrainHeightField, type TerrainHeightField } from './terrain-heightfield.ts';

/** glTF material name carried by every base-city tile. */
export const BASE_CITY_MATERIAL = 'basecity:facade';

/** The lane look is on unless the address says `laneWalls=0` (a kill switch for the back-lane walls). */
export function laneWallsEnabled(search = typeof location === 'undefined' ? '' : location.search) {
  return new URLSearchParams(search).get('laneWalls') !== '0';
}

/** Trade-matched shop interiors are on unless the address says `shopVariety=0`. */
export function shopVarietyEnabled(search = typeof location === 'undefined' ? '' : location.search) {
  return new URLSearchParams(search).get('shopVariety') !== '0';
}

export interface FacadeLightState {
  /** Unit vector from the scene toward the key light: the sun, or the moon key that replaces it after sunset. */
  sunDirection: THREE.Vector3;
  /** Unit vector toward the real sun when the key light is not the sun; the baked sunlit stretch is read along it. */
  arcDirection?: THREE.Vector3;
  /** How much of the key light is sunlight, 0 to 1. Zero under a moon key: the bake knows nothing about the moon. */
  daylight: number;
  night: number;
  /** The key light whose shadow map covers the area around the player. */
  shadowLight?: THREE.DirectionalLight;
  /** The sky's zenith and horizon colours, as the sky dome draws them. */
  skyTop?: THREE.Color;
  skyHorizon?: THREE.Color;
  elapsed: number;
}

/**
 * One facade for every generic building. A tile arrives as plain grey massing
 * whose occlusion texture is the baked light map; `adopt` turns that material
 * into the facade: walls, windows, street floor and roof are drawn from each
 * wall's metre coordinates and the building's style and seed, and the light map
 * supplies sky light and, beyond the reach of the sun's shadow map, the sun.
 */
export function createBaseCityFacade(renderer: THREE.WebGLRenderer) {
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let city = facadeCity();
  let signs = createShopSignAtlas(anisotropy, city), tallSigns = createTallSignAtlas(anisotropy, city);
  const noPanels = new THREE.DataArrayTexture(new Uint8Array([128, 128, 128, 0]), 1, 1, 1);
  noPanels.format = THREE.RGBAFormat; noPanels.needsUpdate = true;
  let panelTexture: THREE.DataArrayTexture | undefined, terrainField: TerrainHeightField | undefined;
  const noTerrain = new THREE.DataTexture(new Float32Array([0]), 1, 1, THREE.RedFormat, THREE.FloatType);
  noTerrain.needsUpdate = true;
  const uniforms = {
    uBcSunArc: { value: 0.5 }, uBcSunBake: { value: 1 }, uBcNight: { value: 0 }, uBcTime: { value: 0 },
    // Back-lane walls (flag 8 of a newer package) drawn as lanes; `?laneWalls=0` draws them as street fronts again.
    uBcLane: { value: laneWallsEnabled() ? 1 : 0 },
    // Street-floor interiors follow the trade on the board; `?shopVariety=0` brings back the one shelf look.
    uBcShops: { value: shopVarietyEnabled() ? 1 : 0 },
    uBcSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5) }, uBcSunColor: { value: new THREE.Color(0, 0, 0) },
    uBcSkyTop: { value: new THREE.Color('#587fa7') }, uBcSkyHorizon: { value: new THREE.Color('#b1c3ca') },
    uBcShadowCenter: { value: new THREE.Vector3() }, uBcShadowRight: { value: new THREE.Vector3(1, 0, 0) },
    uBcShadowUp: { value: new THREE.Vector3(0, 0, 1) }, uBcShadowExtent: { value: 0 },
    tBcTerrain: { value: noTerrain }, uBcTerrainEnabled: { value: 0 },
    uBcTerrainOrigin: { value: new THREE.Vector2() }, uBcTerrainSize: { value: new THREE.Vector2(1, 1) },
    uBcTerrainStep: { value: 1 }, uBcTerrainNodata: { value: -9999 },
    tBcSign: { value: signs.texture }, tBcSignTall: { value: tallSigns.texture },
    tBcPanel: { value: noPanels as THREE.DataArrayTexture },
    uBcPanel: { value: Array.from({ length: MAX_PANELS }, () => new THREE.Vector4(1, 1, 3, 3)) },
    uBcStylePanels: { value: Array.from({ length: PANEL_STYLES.length }, () => new THREE.Vector2(0, 0)) },
  };
  const adopted = new WeakSet<THREE.Material>();
  let arc: Triple[] = [], materialCount = 0;

  /** Select once, from the manifest, before adopting any tile materials. */
  function setCity(id?: string) {
    const selected = facadeCity(id);
    if (selected.id === city.id) return;
    if (materialCount) throw new Error('Cannot change city after adopting base-city materials');
    city = selected;
    signs.texture.dispose(); tallSigns.texture.dispose();
    signs = createShopSignAtlas(anisotropy, city); tallSigns = createTallSignAtlas(anisotropy, city);
    uniforms.tBcSign.value = signs.texture; uniforms.tBcSignTall.value = tallSigns.texture;
  }

  /** A separate terrain texture shifts only Montréal's shop floors, never its upper storeys. */
  function setTerrainHeightField(field: TerrainHeightField) {
    if (city.id !== 'montreal') { field.texture.dispose(); throw new Error('Terrain shop floors are only supported by Montréal'); }
    if (field.width > renderer.capabilities.maxTextureSize || field.height > renderer.capabilities.maxTextureSize) {
      field.texture.dispose(); throw new Error('Base-city terrain heightfield exceeds this device texture limit');
    }
    if (terrainField?.texture !== field.texture) terrainField?.texture.dispose();
    terrainField = field;
    uniforms.tBcTerrain.value = field.texture; uniforms.uBcTerrainEnabled.value = 1;
    uniforms.uBcTerrainOrigin.value.set(...field.origin); uniforms.uBcTerrainSize.value.set(field.width, field.height);
    uniforms.uBcTerrainStep.value = field.step; uniforms.uBcTerrainNodata.value = field.nodata;
  }

  /**
   * `far` is a tile's far tier: small faces are left out of it, so it is drawn
   * two-sided and a gap shows the wall behind it instead of the sky.
   */
  function adopt(material: THREE.Material, far = false): THREE.Material {
    if (!(material instanceof THREE.MeshStandardMaterial) || adopted.has(material)) return material;
    adopted.add(material); materialCount++;
    material.color.set('#ffffff'); material.roughness = 1; material.metalness = 0; material.aoMapIntensity = 1;
    material.envMapIntensity = 1; material.side = far ? THREE.DoubleSide : THREE.FrontSide;
    // Hand-made facade layers hang on the same official walls: where the two coincide, the hand-made surface wins.
    material.polygonOffset = true; material.polygonOffsetFactor = 1; material.polygonOffsetUnits = 2;
    if (material.aoMap) { material.aoMap.generateMipmaps = false; material.aoMap.minFilter = THREE.LinearFilter; material.aoMap.magFilter = THREE.LinearFilter; material.aoMap.needsUpdate = true; }
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${FACADE_PARS_VERTEX}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FACADE_VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FACADE_PARS_FRAGMENT.replace(HONG_KONG.parameters, city.parameters)}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${city.fragment ?? FACADE_FRAGMENT}\ndiffuseColor.rgb = bcAlbedo;`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = bcRoughness;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = bcMetalness;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += bcEmissive;')
        .replace('#include <aomap_fragment>', FACADE_LIGHT);
    };
    material.customProgramCacheKey = () => `basecity-facade-7:${city.id}`;
    material.needsUpdate = true;
    return material;
  }

  /** Photographed fronts for the upper floors; a style without panels keeps its drawn windows. */
  let panelSet: FacadePanelSet | undefined, panelsOn = true;
  function setPanels(set: FacadePanelSet | undefined) {
    if (set?.texture !== panelTexture) panelTexture?.dispose();
    panelSet = set; panelTexture = set?.texture;
    uniforms.tBcPanel.value = set?.texture ?? noPanels;
    uniforms.uBcStylePanels.value.forEach(range => range.set(0, 0));
    if (!panelsOn) return;
    set?.panels.forEach((panel, layer) => {
      uniforms.uBcPanel.value[layer].set(panel.bays, panel.storeys, panel.bay_m, panel.storey_m);
      const range = uniforms.uBcStylePanels.value[city.styles.indexOf(panel.style)];
      if (!range) return;
      if (!range.y) range.x = layer;
      range.y++;
    });
  }

  /** Off: every style draws its own windows (the low graphics setting); the panels stay loaded. */
  function setPanelsEnabled(enabled: boolean) { if (panelsOn !== enabled) { panelsOn = enabled; setPanels(panelSet); } }

  /** Off: walls a package flags as back-lane walls are drawn as street fronts (their relief boxes stay). */
  function setLaneWallsEnabled(enabled: boolean) { uniforms.uBcLane.value = enabled ? 1 : 0; }

  /** Sun directions the light map's sun interval is measured along, sunrise to sunset. */
  function setSunArc(directions: number[][]) { arc = directions.map(d => new THREE.Vector3(d[0], d[1], d[2]).normalize().toArray() as Triple); }

  function update(state: FacadeLightState) {
    uniforms.uBcSunDir.value.copy(state.sunDirection).normalize();
    uniforms.uBcSunArc.value = sunArcPosition(arc, (state.arcDirection ?? uniforms.uBcSunDir.value).toArray() as Triple);
    uniforms.uBcSunBake.value = THREE.MathUtils.clamp(state.daylight, 0, 1);
    uniforms.uBcNight.value = THREE.MathUtils.smoothstep(state.night, 0.08, 0.85);
    uniforms.uBcTime.value = state.elapsed;
    if (state.skyTop) uniforms.uBcSkyTop.value.copy(state.skyTop);
    if (state.skyHorizon) uniforms.uBcSkyHorizon.value.copy(state.skyHorizon);
    const light = state.shadowLight;
    if (light) uniforms.uBcSunColor.value.copy(light.color).multiplyScalar(light.intensity);
    else uniforms.uBcSunColor.value.setScalar(0);
    if (light?.castShadow) {
      const camera = light.shadow.camera as THREE.OrthographicCamera;
      uniforms.uBcShadowCenter.value.copy(light.target.position);
      // The shadow camera looks from the light to its target; its right and up
      // axes span the plane the shadow map covers.
      const forward = uniforms.uBcSunDir.value;
      const right = uniforms.uBcShadowRight.value.crossVectors(camera.up, forward);
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      right.normalize();
      uniforms.uBcShadowUp.value.crossVectors(forward, right).normalize();
      uniforms.uBcShadowExtent.value = Math.min(camera.right, camera.top);
    } else uniforms.uBcShadowExtent.value = 0;
  }

  return { adopt, update, setCity, setTerrainHeightField,
    groundHeight(x: number, z: number, fallback: number) { return terrainField ? sampleTerrainHeightField(terrainField, x, z, fallback) : fallback; }, get city() { return city; }, setSunArc, setPanels, setPanelsEnabled, setLaneWallsEnabled, uniforms, dispose() { signs.texture.dispose(); tallSigns.texture.dispose(); panelTexture?.dispose(); terrainField?.texture.dispose(); noTerrain.dispose(); noPanels.dispose(); } };
}

export type BaseCityFacade = ReturnType<typeof createBaseCityFacade>;
