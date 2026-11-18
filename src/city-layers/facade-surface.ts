import * as THREE from 'three';

/** Opt-in surface treatment for an already classified facade mesh. This is not
 * a building generator: it never changes a silhouette, opening, UV or collider.
 * The reflected street is an art-directed proxy, not a survey or a ray trace. */
export interface FacadeSurfaceSpec {
  kind: 'wall' | 'glass' | 'metal';
  /** `pane`: each integer raw-UV cell is one authored window (before atlas repeat).
   * `metres`: raw UVs are facade metres, divided by cellSize. */
  uvMode?: 'pane' | 'metres';
  /** Already-visible blind/curtain under a virtual glazing coating. Keeps the
   * rough diffuse cloth; requires a physical material with clearcoat enabled. */
  glazedUnderlay?: boolean;
  cellSize?: [number, number];
  panelSize?: [number, number];
  seed?: number;
  normalStrength?: number;
  roughnessVariation?: number;
  weathering?: number;
  reflectionStrength?: number;
  /** Historical packages retain the original response when this is omitted.
   * `soft` filters the reflected footprint and uses a restrained glazing lobe. */
  reflectionProfile?: 'legacy' | 'soft';
  /** Proxy-reflection microfacet width, not the rough diffuse cloth beneath it. */
  reflectionRoughness?: number;
  streetWidth?: number;
  oppositeHeight?: number;
  reflectionTint?: string;
}
export interface FacadeSurfaceClock { daylight: {value: number} }
export function createFacadeSurfaceClock(): FacadeSurfaceClock { return {daylight: {value: 1}}; }
export function updateFacadeSurfaceClock(clock: FacadeSurfaceClock, daylight: number) {
  clock.daylight.value = Number.isFinite(daylight) ? THREE.MathUtils.clamp(daylight, 0, 1) : 0;
}

export function validateFacadeSurface(input: FacadeSurfaceSpec, label = 'facadeSurface'): FacadeSurfaceSpec {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${label}: expected an object`);
  const fields = new Set(['kind','uvMode','glazedUnderlay','cellSize','panelSize','seed','normalStrength','roughnessVariation','weathering','reflectionStrength','reflectionProfile','reflectionRoughness','streetWidth','oppositeHeight','reflectionTint']);
  for (const key of Object.keys(input)) if (!fields.has(key)) throw new Error(`${label}.${key}: unknown field`);
  if (!['wall','glass','metal'].includes(input.kind)) throw new Error(`${label}.kind: expected wall, glass or metal`);
  if (input.uvMode !== undefined && !['pane','metres'].includes(input.uvMode)) throw new Error(`${label}.uvMode: expected pane or metres`);
  for (const key of ['cellSize','panelSize'] as const) {
    const v = input[key];
    if (v !== undefined && (!Array.isArray(v) || v.length !== 2 || !v.every(n => Number.isFinite(n) && n > 0 && n <= 100))) throw new Error(`${label}.${key}: expected two positive metre dimensions <= 100`);
  }
  for (const [key, min, max] of [['seed',0,65535],['normalStrength',0,.1],['roughnessVariation',0,.4],['weathering',0,.5],['reflectionStrength',0,1],['streetWidth',1,100],['oppositeHeight',1,200]] as const) {
    const v = input[key];
    if (v !== undefined && (!Number.isFinite(v) || v < min || v > max)) throw new Error(`${label}.${key}: expected finite value in [${min}, ${max}]`);
  }
  if (input.reflectionTint !== undefined && !/^#[0-9a-f]{6}$/i.test(input.reflectionTint)) throw new Error(`${label}.reflectionTint: expected #rrggbb`);
  if (input.glazedUnderlay !== undefined && (typeof input.glazedUnderlay !== 'boolean' || input.kind !== 'glass')) throw new Error(`${label}.glazedUnderlay: expected boolean on glass only`);
  if (input.reflectionProfile !== undefined && (input.kind !== 'glass' || !['legacy','soft'].includes(input.reflectionProfile))) throw new Error(`${label}.reflectionProfile: expected legacy or soft on glass only`);
  if (input.reflectionRoughness !== undefined && (input.kind !== 'glass' || input.reflectionProfile !== 'soft' || !Number.isFinite(input.reflectionRoughness) || input.reflectionRoughness < .04 || input.reflectionRoughness > .6)) throw new Error(`${label}.reflectionRoughness: expected finite width in [.04, .6] with soft glass profile`);
  if (input.kind !== 'glass' && (input.reflectionStrength ?? 0) !== 0) throw new Error(`${label}: proxy reflection is glass-only`);
  return {...input};
}

// Original small shader, deliberately separate from the source reference's
// implementation. No per-frame random state: cells and orientation are attached
// to the mesh, not the camera; explicit derivatives make distant panes converge.
const common = /* glsl */`
  varying vec2 vFacadeRawUv;
  varying vec3 vFacadeWorld;
  uniform vec2 uFacadeCellSize, uFacadePanelSize;
  uniform vec4 uFacadeFinish, uFacadeReflection;
  uniform vec3 uFacadeTint;
  uniform float uFacadeDaylight;
  #ifdef DISTRICT_FACADE_PHOTO
    uniform sampler2D tFacadeReflection;
  #endif
  float facadeHash(vec2 p) {
    return fract(sin(dot(p, vec2(39.3467, 11.1351)) + uFacadeFinish.w * .731) * 47453.5453);
  }
  // The proxy scene is shared by every glazing material. Per-pane finishes
  // may differ, but neighbouring windows must not invent different rooflines.
  float facadeSceneHash(vec2 p) {
    return fract(sin(dot(p, vec2(27.819, 63.127))) * 38157.693);
  }
  float facadeNoise(vec2 p) {
    vec2 q = floor(p), t = fract(p); t = t * t * (3.0 - 2.0 * t);
    return mix(mix(facadeHash(q), facadeHash(q + vec2(1,0)), t.x),
               mix(facadeHash(q + vec2(0,1)), facadeHash(q + vec2(1,1)), t.x), t.y);
  }
  vec2 facadeCellUv() {
    #ifdef DISTRICT_FACADE_PANE
      return vFacadeRawUv;
    #else
      return vFacadeRawUv / uFacadeCellSize;
    #endif
  }
`;
const surface = /* glsl */`
  vec2 facadeUv = facadeCellUv();
  vec2 facadeCell = floor(facadeUv), facadeIn = fract(facadeUv);
  float facadeSeed = facadeHash(facadeCell);
  float facadeCoverage = 1.0 - smoothstep(.16, .65, max(fwidth(facadeUv.x), fwidth(facadeUv.y)));
  float facadeEdgeDistance = min(min(facadeIn.x, 1.0-facadeIn.x), min(facadeIn.y, 1.0-facadeIn.y));
  float facadeDust = (1.0 - smoothstep(.015,.10,facadeEdgeDistance)) * uFacadeFinish.z * facadeCoverage;
  #ifdef DISTRICT_FACADE_GLASS
    // Thin frame-edge deposits, not brown stains spread across the whole pane.
    diffuseColor.rgb *= 1.0 - facadeDust * .32;
  #else
    // Texture/vertex colour remains the source of masonry detail. Only slow,
    // low-amplitude variation is added; no artificial window grid on a wall.
    float facadePatina = (facadeNoise(vFacadeRawUv * vec2(.31,.23)) - .5) * uFacadeFinish.z;
    diffuseColor.rgb *= 1.0 + facadePatina * .42;
  #endif
`;
const roughness = /* glsl */`
  #if defined(DISTRICT_FACADE_GLASS) && !defined(DISTRICT_FACADE_UNDERLAY)
    roughnessFactor = clamp(roughnessFactor + uFacadeFinish.y * (facadeSeed-.5) + facadeDust*.32, .035, .55);
    #ifdef DISTRICT_FACADE_SOFT
      // Broaden the physical highlight as well as the proxy image. Shop glass
      // with a separate local probe (proxy strength zero) keeps its old finish.
      if (uFacadeReflection.x > .0001) roughnessFactor = max(roughnessFactor, uFacadeReflection.w * .8);
    #endif
  #else
    roughnessFactor = clamp(roughnessFactor + uFacadeFinish.y * (facadeNoise(vFacadeRawUv*.65)-.5), .16, 1.0);
  #endif
`;
const normals = /* glsl */`
  // A horizontal/vertical world frame survives atlas UV rotations and mirrored
  // tangents. The base normal map has already been applied at this hook.
  #ifdef DISTRICT_FACADE_UNDERLAY
    vec3 facadeWorldN = inverseTransformDirection(nonPerturbedNormal, viewMatrix);
  #else
    vec3 facadeWorldN = inverseTransformDirection(normal, viewMatrix);
  #endif
  vec3 facadeRight = normalize(vec3(facadeWorldN.z, 0.0, -facadeWorldN.x) + vec3(.00001,0,0));
  vec3 facadeUp = normalize(cross(facadeWorldN, facadeRight));
  #ifdef DISTRICT_FACADE_GLASS
    vec2 facadeTilt = vec2(facadeHash(facadeCell+vec2(2,7)),facadeHash(facadeCell+vec2(17,4))) - .5;
    vec2 facadeBow = sin((facadeIn-.5) * 3.14159265) * (.38 + facadeSeed * .35);
    vec2 facadeSlope = (facadeTilt + facadeBow) * uFacadeFinish.x * facadeCoverage;
    #ifdef DISTRICT_FACADE_SOFT
      if (uFacadeReflection.x > .0001) facadeSlope *= .65;
    #endif
  #else
    vec2 facadeSlope = vec2(sin(vFacadeRawUv.y*.7),sin(vFacadeRawUv.x*.8)) * uFacadeFinish.x * .35;
  #endif
  facadeWorldN = normalize(facadeWorldN + facadeRight*facadeSlope.x + facadeUp*facadeSlope.y);
  #ifndef DISTRICT_FACADE_UNDERLAY
    normal = normalize((viewMatrix * vec4(facadeWorldN,0.0)).xyz);
  #endif
`;
const reflection = /* glsl */`
  #ifdef DISTRICT_FACADE_GLASS
    if (uFacadeReflection.x > .0001) {
      vec3 facadeEye = normalize(cameraPosition - vFacadeWorld);
      vec3 facadeRay = reflect(-facadeEye, facadeWorldN);
      // Intersect a finite stand-in street wall. It does not claim to reconstruct
      // the actual opposite building. Local shop probes remain a separate path.
      float facadeTravel = min(180.0, uFacadeReflection.y / max(.22,dot(facadeRay,facadeWorldN)));
      vec3 facadeHit = vFacadeWorld + facadeRay * facadeTravel;
      float facadeAlong = dot(facadeHit,facadeRight);
      float facadeBlock = floor(facadeAlong/15.0);
      float facadeRoof = uFacadeReflection.z * (.78 + .42*facadeSceneHash(vec2(facadeBlock,3.0)));
      vec2 facadePhotoUv = vec2(facadeAlong, -facadeHit.y) / uFacadePanelSize;
      vec3 facadeWall;
      #ifdef DISTRICT_FACADE_PHOTO
        // Texture is authored in sRGB; Three/WebGL decodes its sample to linear.
        #ifdef DISTRICT_FACADE_SOFT
          // Filter the reflected WORLD footprint, not the receiver's UV grid.
          // A rougher pane and a longer ray spread a wider cone on the opposite
          // wall. Explicit gradients retain minification at oblique/distant
          // views and avoid displaying a sharp photo pasted into every pane.
          float facadeCone = clamp(facadeTravel * (.0025 + .45*uFacadeReflection.w*uFacadeReflection.w), .04, 1.35);
          vec2 facadeFootprint = max(fwidth(facadePhotoUv), vec2(facadeCone) / uFacadePanelSize);
          facadeWall = textureGrad(tFacadeReflection, facadePhotoUv,
            vec2(facadeFootprint.x,0.0), vec2(0.0,facadeFootprint.y)).rgb;
          // Retain masonry colour and window shapes, but roll off the bright
          // panel highlights rather than treating the reference image as light.
          float facadeLuma = dot(facadeWall,vec3(.2126,.7152,.0722));
          facadeWall = mix(vec3(facadeLuma),facadeWall,.92);
          facadeWall /= 1.0 + .12*facadeWall;
        #else
          facadeWall = texture2D(tFacadeReflection, facadePhotoUv).rgb;
        #endif
      #else
        vec2 facadeWindowUv = fract(vec2(facadeAlong/2.9,facadeHit.y/3.4));
        vec2 facadeAA = max(fwidth(vec2(facadeAlong/2.9,facadeHit.y/3.4)),vec2(.015));
        #ifdef DISTRICT_FACADE_SOFT
          float facadeProceduralCone = clamp(facadeTravel * (.0025 + .45*uFacadeReflection.w*uFacadeReflection.w), .04, 1.35);
          facadeAA = max(facadeAA,vec2(facadeProceduralCone)/vec2(2.9,3.4));
        #endif
        float facadeWindow = smoothstep(.16-facadeAA.x,.16+facadeAA.x,facadeWindowUv.x) *
          (1.0-smoothstep(.69-facadeAA.x,.69+facadeAA.x,facadeWindowUv.x)) *
          smoothstep(.18-facadeAA.y,.18+facadeAA.y,facadeWindowUv.y) *
          (1.0-smoothstep(.80-facadeAA.y,.80+facadeAA.y,facadeWindowUv.y));
        facadeWall = mix(uFacadeTint,vec3(.035,.047,.055),facadeWindow);
      #endif
      // Exposed opposite facades carry more daylight than the shaded receiver.
      #ifdef DISTRICT_FACADE_SOFT
        facadeWall *= (.020 + 1.30*uFacadeDaylight) * (.80+.20*facadeSceneHash(vec2(facadeBlock,8.0)));
      #else
        facadeWall *= (.025 + 1.45*uFacadeDaylight) * (.80+.20*facadeSceneHash(vec2(facadeBlock,8.0)));
      #endif
      vec3 facadeSky = mix(vec3(.008,.012,.022),mix(vec3(.42,.48,.53),vec3(.17,.28,.39),clamp(facadeRay.y,0.0,1.0)),uFacadeDaylight);
      float facadeSkyMask = smoothstep(facadeRoof-1.2,facadeRoof+1.2,facadeHit.y);
      vec3 facadeReflected = mix(facadeWall,facadeSky,facadeSkyMask);
      facadeReflected = mix(vec3(.014,.017,.018)*(.10+.9*uFacadeDaylight),facadeReflected,smoothstep(-1.0,2.0,facadeHit.y));
      // Art-directed coating response, not a measured dielectric BRDF.
      #ifdef DISTRICT_FACADE_SOFT
        float facadeFresnel = .14 + .52 * pow(1.0-clamp(dot(facadeEye,facadeWorldN),0.0,1.0),5.0);
      #else
        float facadeFresnel = .18 + .60 * pow(1.0-clamp(dot(facadeEye,facadeWorldN),0.0,1.0),4.0);
      #endif
      float facadeAmount = uFacadeReflection.x * facadeFresnel * (1.0-facadeDust) * (.82+.18*facadeSeed);
      // Keep the original energy split. The soft profile broadens the physical
      // lobe above; stripping it again would turn shaded windows almost black.
      float facadeEnvironmentKeep = 1.0 - .55*uFacadeReflection.x;
      // Replace part of the broad HDR specular rather than double-add a mirror.
      #ifdef DISTRICT_FACADE_UNDERLAY
        // This mesh represents cloth seen THROUGH glass, not polished cloth.
        // Preserve its diffuse/rough base, attenuate transmitted energy, and put
        // the reflected image on the separate smooth coating lobe.
        reflectedLight.directDiffuse *= 1.0-facadeAmount;
        reflectedLight.indirectDiffuse *= 1.0-facadeAmount;
        #ifdef USE_CLEARCOAT
          clearcoatSpecularIndirect *= facadeEnvironmentKeep;
          clearcoatSpecularIndirect += facadeReflected * facadeAmount;
        #endif
      #else
        reflectedLight.indirectSpecular *= facadeEnvironmentKeep;
        reflectedLight.indirectSpecular += facadeReflected * facadeAmount;
      #endif
    }
  #endif
`;

export function installFacadeSurface(material: THREE.MeshStandardMaterial, raw: FacadeSurfaceSpec,
  clock: FacadeSurfaceClock, photo?: THREE.Texture) {
  const spec = validateFacadeSurface(raw, `${material.name}.facadeSurface`);
  const isGlass = spec.kind === 'glass';
  const isSoft = isGlass && spec.reflectionProfile === 'soft';
  if (spec.glazedUnderlay && (!(material instanceof THREE.MeshPhysicalMaterial) || material.clearcoat<=0)) throw new Error(`${material.name}: glazedUnderlay requires a physical material with clearcoat`);
  const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey();
  const uniforms = {
    uFacadeCellSize: {value: new THREE.Vector2(...(spec.cellSize ?? [1.5,3.2]))},
    uFacadePanelSize: {value: new THREE.Vector2(...(spec.panelSize ?? [9,7]))},
    uFacadeFinish: {value: new THREE.Vector4(spec.normalStrength ?? (isGlass?.02:0), spec.roughnessVariation ?? .035, spec.weathering ?? .08, spec.seed ?? 0)},
    uFacadeReflection: {value: new THREE.Vector4(spec.reflectionStrength ?? (isGlass?.25:0),spec.streetWidth ?? 18,spec.oppositeHeight ?? 22,isSoft ? (spec.reflectionRoughness ?? .18) : 0)},
    uFacadeTint: {value: new THREE.Color(spec.reflectionTint ?? '#b4aea1')},
    uFacadeDaylight: clock.daylight,
    ...(photo ? {tFacadeReflection:{value:photo}} : {}),
  };
  const flags = [isGlass?'#define DISTRICT_FACADE_GLASS':'',spec.uvMode==='pane'?'#define DISTRICT_FACADE_PANE':'',photo?'#define DISTRICT_FACADE_PHOTO':'',spec.glazedUnderlay?'#define DISTRICT_FACADE_UNDERLAY':'',isSoft?'#define DISTRICT_FACADE_SOFT':''].join('\n');
  material.onBeforeCompile = function(shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFacadeRawUv;\nvarying vec3 vFacadeWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vFacadeRawUv = uv;
        vec4 facadePosition = vec4(transformed,1.0);
        #ifdef USE_BATCHING
          facadePosition = batchingMatrix * facadePosition;
        #endif
        #ifdef USE_INSTANCING
          facadePosition = instanceMatrix * facadePosition;
        #endif
        vFacadeWorld = (modelMatrix * facadePosition).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + flags + '\n' + common)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + surface)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + roughness)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + normals)
      .replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>
        #if defined(DISTRICT_FACADE_UNDERLAY) && defined(USE_CLEARCOAT)
          clearcoatNormal = normalize((viewMatrix * vec4(facadeWorldN,0.0)).xyz);
        #endif`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #if defined(DISTRICT_FACADE_SOFT) && defined(USE_CLEARCOAT)
          if (uFacadeReflection.x > .0001) material.clearcoatRoughness = max(material.clearcoatRoughness,uFacadeReflection.w*.8);
        #endif`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + reflection);
  };
  material.customProgramCacheKey = () => `${previousKey}|district-facade-surface-v3|${spec.kind}|${spec.uvMode??'metres'}|${photo?'photo':'procedural'}|${spec.glazedUnderlay?'underlay':'surface'}${isSoft?'|soft-v2':''}`;
  material.userData.facadeSurface = {...spec,reflectionSource:isGlass && (spec.reflectionStrength??.25)>0 ? (photo?'authored-panel-proxy':'procedural-proxy'):'existing-environment'};
  // Enumerable texture property participates in the runtime's existing resource
  // census/disposal; clones share uniforms and the original material lease.
  if (photo) Object.assign(material, {facadeReflectionMap:photo});
  material.needsUpdate = true;
}
