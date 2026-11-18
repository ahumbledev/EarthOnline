import * as THREE from 'three';
import { createBaseCityFacade } from './facade-material.ts';
import { installFacadeSurface } from './facade-surface.ts';
import { ROOMS_GLSL, tokyoRoomLight } from './rooms-glsl.ts';
import { WEAR_GLSL } from './helsinki-wear.ts';
import { gradeFor, TOKYO_LOOK } from './street-look.ts';
import { cityPhaseBlend, createCityLook, sampleCityLook } from './city-look.ts';
import { createCitySkyMaterial, updateCitySky } from './city-sky.ts';
import { PHILADELPHIA_PHASES } from './philadelphia-phases.ts';

export function usesEncodedFacade(cityId: string) {
  return cityId.startsWith('hong-kong') || cityId === 'montreal';
}

export function facadeStyle(cityId: string, height: number, seed: number) {
  if (cityId === 'montreal') {
    if (height > 40) return seed % 2 === 0 ? 3 : 4;
    return height > 17 ? seed % 2 : seed % 3;
  }
  if (height > 45) return seed % 4 === 0 ? 4 : 3;
  return height > 20 ? 1 + seed % 2 : seed % 2;
}

export function attachCityFacade(cityId: string, renderer: THREE.WebGLRenderer,
  material: THREE.MeshStandardMaterial, night: { value: number }) {
  if (usesEncodedFacade(cityId)) {
    const facade = createBaseCityFacade(renderer);
    facade.setCity(cityId.startsWith('hong-kong') ? 'hong-kong' : cityId);
    facade.uniforms.uBcNight = night;
    facade.uniforms.uBcSunBake.value = 0;
    material.vertexColors = false;
    facade.adopt(material, true);
    return facade;
  }
  if (cityId === 'melbourne') {
    installFacadeSurface(material, {
      kind: 'wall', uvMode: 'metres', weathering: .13, roughnessVariation: .06, normalStrength: .025,
    }, {daylight: {get value() { return 1 - night.value; }}});
  }
  if (cityId === 'helsinki' || cityId.startsWith('tokyo')) {
    const tokyo = cityId.startsWith('tokyo');
    const original = material.onBeforeCompile.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      original(shader, renderer);
      const varying = 'varying vec3 districtPoint; varying vec3 districtNormal;';
      shader.vertexShader = varying + '\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ndistrictPoint=(modelMatrix*vec4(transformed,1.)).xyz; districtNormal=normalize(mat3(modelMatrix)*objectNormal);',
      );
      shader.fragmentShader = varying + '\n' + (tokyo ? ROOMS_GLSL : WEAR_GLSL) + '\n' + shader.fragmentShader;
      if (tokyo) {
        shader.uniforms.tokyoRoomLight = tokyoRoomLight;
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          vec3 surfaceNormal = normalize(districtNormal);
          surfaceNormal *= sign(dot(surfaceNormal,cameraPosition-districtPoint));
          float facing, lit;
          vec3 room = tokyoRoom(districtPoint,surfaceNormal,vec2(0.),vec2(3.1,3.25),.52,facing,lit);
          totalEmissiveRadiance += room * window * (.55+.45*facing);`);
      } else {
        shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
          float facadeSeed=round(dot(districtPoint,districtNormal));
          diffuseColor.rgb=usedPaint(diffuseColor.rgb,facadeUV,facadeSeed,.86*(1.-window));
          diffuseColor.rgb=sillRunoff(diffuseColor.rgb,vec2(p.x,1.-p.y),vec4(.14,.17,.79,.77),vec2(1./3.1,1./3.25),floor(tile.y)+facadeSeed,.65*(1.-window));`);
      }
    };
    material.customProgramCacheKey = () => tokyo ? 'tokyo-room-windows' : 'helsinki-wall-wear';
  }
}

/** The sky uses a camera-centred dome and is drawn at the far depth plane. */
export function createDistrictSky(cityId: string) {
  const material = createCitySkyMaterial();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(5, 32, 20), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  const sun = new THREE.Vector3();
  const look = createCityLook();
  const temp = new THREE.Color();
  const tokyo = cityId.startsWith('tokyo');
  function update(sunDirection: readonly [number, number, number], night: number,
    elapsed: number, cameraPosition: THREE.Vector3, hour: number) {
    sun.set(...sunDirection);
    sampleCityLook(sun.y, look);
    if (cityId === 'philadelphia') {
      const {from, to, t} = cityPhaseBlend(sun.y);
      const a = PHILADELPHIA_PHASES[from], b = PHILADELPHIA_PHASES[to];
      for (const k of ['zenith','horizon','antisolar','haze','sunGlow','cloudLit','cloudShade','cityGlow'] as const)
        look[k].set(a[k]).lerp(temp.set(b[k]), t);
      for (const k of ['sunHalo','cloudOpacity','cityGlowStrength','stars','hazeDensity'] as const)
        look[k] = THREE.MathUtils.lerp(a[k], b[k], t);
    } else if (tokyo) {
      const grade = gradeFor(hour);
      look.haze.setRGB(grade.fog[0], grade.fog[1], grade.fog[2]);
      look.horizon.lerp(look.haze, .35);
      look.hazeDensity = grade.fogDensity;
      tokyoRoomLight.value.set(TOKYO_LOOK.rooms.day * (1 - night), TOKYO_LOOK.rooms.night * night);
    }
    mesh.position.copy(cameraPosition);
    updateCitySky(material, look, sun, elapsed);
    return look;
  }
  return {mesh, update};
}
