/** How dirt, water and the two finding aids look on the car's own materials.
 * Coverage edges are broken up with noise taken in 3D (vehicle space), so they run continuously across UV seams.
 * A texel reads as dirty from about the original PixelDirtyThreshold (0.25), so what counts is what shows. */
import * as THREE from 'three';

export interface WashUniforms {
  uWashState:{value:THREE.Texture|null}; uWashPart:{value:THREE.Texture|null};
  uWashTime:{value:number}; uWashDry:{value:number};
  /** 0..1 strength of the yellow "show remaining dirt" pulse. */
  uWashHighlight:{value:number};
  /** Owning part index flashing white, or -1. */
  uWashSelected:{value:number};
}
export function washUniforms():WashUniforms {
  return {uWashState:{value:null},uWashPart:{value:null},uWashTime:{value:0},uWashDry:{value:40},uWashHighlight:{value:0},uWashSelected:{value:-1}};
}
const NOISE=`
float washHash(vec3 p){p=fract(p*.3183099+vec3(.71,.113,.419));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float washNoise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
  return mix(mix(mix(washHash(i),washHash(i+vec3(1,0,0)),f.x),mix(washHash(i+vec3(0,1,0)),washHash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(washHash(i+vec3(0,0,1)),washHash(i+vec3(1,0,1)),f.x),mix(washHash(i+vec3(0,1,1)),washHash(i+vec3(1,1,1)),f.x),f.y),f.z);}`;

export function patchMaterial(material:THREE.MeshStandardMaterial,uniforms:WashUniforms,glass=false){
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='varying vec2 vWashUv;varying vec3 vWashPos;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvWashUv=uv;vWashPos=(modelMatrix*vec4(position,1.)).xyz;');
    shader.fragmentShader=`uniform sampler2D uWashState,uWashPart;uniform float uWashTime,uWashDry,uWashHighlight,uWashSelected;varying vec2 vWashUv;varying vec3 vWashPos;${NOISE}\n`+shader.fragmentShader
      .replace('#include <color_fragment>',`#include <color_fragment>
  vec4 washS=texture2D(uWashState,vWashUv);
  float washA=washNoise(vWashPos*26.),washB=washNoise(vWashPos*90.),washJ=(washA-.5)*.13+(washB-.5)*.045;
  float washDust=smoothstep(.1,.4,washS.r+washJ),washMud=smoothstep(.11,.33,washS.g+washJ*1.2),washGrease=smoothstep(.11,.33,washS.b+washJ);
  float washWet=washS.a>0.?clamp(1.-(uWashTime-washS.a)/uWashDry,0.,1.):0.;
  // Foam where soap last landed: thick at first, sliding down and breaking up over a quarter of a minute.
  // The wash map only knows soap / no soap per texel, so the edge of a foamed patch is read from the texels around
  // (which softens the texel staircase) and then broken up by the bubbles themselves, drawn as a fine cellular shading
  // so foam reads as foam even on white paint.
  float washFoamAge=uWashTime+washS.a,washFoam=0.,washCell=1.,washLump=1.;vec2 washTexel=2.4/vec2(textureSize(uWashState,0));
  float washSoaped=(washS.a<-.5&&washFoamAge>-.5)?1.:0.; // never-wet texels hold a large negative time, so they are not foam
  for(int i=0;i<4;i++){vec2 o=vec2(i<2?-1.:1.,i%2==0?-1.:1.)*washTexel;float a=texture2D(uWashState,vWashUv+o).a;washSoaped+=(a<-.5&&uWashTime+a>-.5)?1.:0.;}
  washSoaped/=5.;
  if(washSoaped>0.){ // only foamed patches pay for the bubbles
    float washThin=smoothstep(3.,19.,washFoamAge);
    float washBubbles=washNoise(vWashPos*vec3(34.,34.,34.)+vec3(0.,washFoamAge*.9,0.))*.55+washNoise(vWashPos*88.+vec3(0.,washFoamAge*1.6,0.))*.3+washNoise(vWashPos*190.)*.15;
    washFoam=washS.a<-.5&&washFoamAge>-.5?1.-smoothstep(11.,19.,washFoamAge):washSoaped;
    washFoam*=smoothstep(.2+.4*washThin,.5+.3*washThin,washBubbles+.12+(washSoaped-1.)*1.1);
    washCell=abs(washNoise(vWashPos*150.+vec3(0.,washFoamAge*.9,0.))-.5)*2.;washLump=washNoise(vWashPos*46.+vec3(0.,washFoamAge*.9,0.));
  }
  float washCover=max(max(washDust,washMud),washGrease);
  vec3 washDustCol=mix(vec3(.33,.30,.25),vec3(.40,.37,.31),washA)*(.94+.1*washB);
  vec3 washMudCol=mix(vec3(.085,.058,.032),vec3(.16,.115,.065),washA)*(1.+.35*smoothstep(.55,.9,washS.g)*(1.-washWet));
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.022,.018,.014),washGrease*.93);
  diffuseColor.rgb=mix(diffuseColor.rgb,washDustCol,washDust*(.42+.43*smoothstep(.35,.9,washS.r)));
  diffuseColor.rgb=mix(diffuseColor.rgb,washMudCol,washMud*.96);
  diffuseColor.rgb*=1.-washWet*.3*washCover;
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.95,.97,.99)*mix(.66,1.,smoothstep(.06,.45,washCell))*(.82+.2*washLump),washFoam*.97);
  ${glass?'diffuseColor.a=mix(diffuseColor.a,1.,max(washFoam,max(washDust*.5,max(washMud,washGrease)*.85)));':''}`)
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
  roughnessFactor=mix(roughnessFactor,.55,washGrease);roughnessFactor=mix(roughnessFactor,.93,washDust*.92);roughnessFactor=mix(roughnessFactor,.82,washMud);
  roughnessFactor=mix(roughnessFactor,.1,washWet*.85);roughnessFactor=mix(roughnessFactor,.78,washFoam);`)
      .replace('#include <metalnessmap_fragment>',`#include <metalnessmap_fragment>
  metalnessFactor*=(1.-washCover)*(1.-washFoam);`)
      .replace('#include <lights_physical_fragment>',`#include <lights_physical_fragment>
  #ifdef USE_CLEARCOAT
  material.clearcoat=mix(material.clearcoat,0.,washCover);material.clearcoat=max(material.clearcoat,washWet*.9)*(1.-washFoam);material.clearcoatRoughness=mix(material.clearcoatRoughness,.03,washWet);
  #endif`)
      .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
  float washOwner=floor(texture2D(uWashPart,vWashUv).r*255.+.5);
  float washPulse=.5+.5*sin(uWashTime*7.);
  if(washOwner<128.&&max(washS.r,max(washS.g,washS.b))>.25)totalEmissiveRadiance+=vec3(1.,.72,.04)*uWashHighlight*(.35+.65*washPulse)*.9;
  if(uWashSelected>=0.&&washOwner<255.&&mod(washOwner,128.)==uWashSelected)totalEmissiveRadiance+=vec3(.85,.9,.88)*(.25+.55*washPulse);`);
  };
  material.customProgramCacheKey=()=>`city-wash-${glass?'glass':'solid'}-${material.type}`;
  material.needsUpdate=true;
}
