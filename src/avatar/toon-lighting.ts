import * as THREE from 'three';

/** MeshToonMaterial has no environment-light path in Three r186. Reuse the
 * scene's diffuse PMREM illumination while retaining its actual toon shader,
 * texture, skinning and direct-light bands. There is no emissive fill. */
export function supportToonEnvironment(material: THREE.MeshToonMaterial) {
  const uniforms = {
    rabbitNight: { value: 0 },
    rabbitEnvironment: { value: null as THREE.Texture | null },
    rabbitEnvironmentIntensity: { value: 0 },
    rabbitEnvironmentTexel: { value: new THREE.Vector2(1 / 768, 1 / 1024) },
    rabbitEnvironmentMaxMip: { value: 8 },
    rabbitEnvironmentRotation: { value: new THREE.Matrix3() },
  };
  const rotation = new THREE.Matrix4();
  material.onBeforeRender = (_renderer, scene) => {
    uniforms.rabbitNight.value = THREE.MathUtils.clamp(Number(scene.userData.avatarNight) || 0,0,1);
    const environment = scene.environment;
    // Our scenes already own PMREM render targets. Do not allocate another
    // reflection map per resident, or claim an arbitrary texture is a PMREM.
    const image = environment?.image as { width?: number; height?: number } | undefined;
    const supported = environment?.mapping === THREE.CubeUVReflectionMapping
      && Number.isFinite(image?.width) && image!.width! > 0 && Number.isFinite(image?.height) && image!.height! > 0;
    uniforms.rabbitEnvironment.value = supported ? environment : null;
    uniforms.rabbitEnvironmentIntensity.value = supported && Number.isFinite(scene.environmentIntensity) ? Math.max(0, scene.environmentIntensity) : 0;
    if (supported) {
      uniforms.rabbitEnvironmentTexel.value.set(1 / image!.width!, 1 / image!.height!);
      uniforms.rabbitEnvironmentMaxMip.value = Math.log2(image!.height!) - 2;
      uniforms.rabbitEnvironmentRotation.value.setFromMatrix4(rotation.makeRotationFromEuler(scene.environmentRotation)).transpose();
    }
  };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', /* glsl */ `
      #include <common>
      uniform float rabbitNight;
      uniform sampler2D rabbitEnvironment;
      uniform float rabbitEnvironmentIntensity;
      uniform vec2 rabbitEnvironmentTexel;
      uniform float rabbitEnvironmentMaxMip;
      uniform mat3 rabbitEnvironmentRotation;
      #define ENVMAP_TYPE_CUBE_UV
      #define CUBEUV_TEXEL_WIDTH rabbitEnvironmentTexel.x
      #define CUBEUV_TEXEL_HEIGHT rabbitEnvironmentTexel.y
      #define CUBEUV_MAX_MIP rabbitEnvironmentMaxMip
      #include <cube_uv_reflection_fragment>
      #undef ENVMAP_TYPE_CUBE_UV
      #undef CUBEUV_TEXEL_WIDTH
      #undef CUBEUV_TEXEL_HEIGHT
      #undef CUBEUV_MAX_MIP
    `).replace('#include <lights_fragment_maps>', /* glsl */ `
      #include <lights_fragment_maps>
      irradiance += PI * vec3(.025,.032,.046) * rabbitNight;
      if (rabbitEnvironmentIntensity > 0.0) {
        vec3 rabbitWorldNormal = transformNormalByInverseViewMatrix(geometryNormal, viewMatrix);
        vec3 rabbitBounce = textureCubeUV(rabbitEnvironment, rabbitEnvironmentRotation * rabbitWorldNormal, 1.0).rgb;
        irradiance += PI * rabbitBounce * rabbitEnvironmentIntensity;
      }
    `).replace('#include <opaque_fragment>', `
      float rabbitRim=pow(1.0-abs(dot(geometryNormal,geometryViewDir)),3.0);
      outgoingLight += diffuseColor.rgb * rabbitRim * .08 * rabbitNight;
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'rabbit-toon-diffuse-pmrem-night-v2';
  return material;
}
