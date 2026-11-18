/** Tiled wash bay with drainage trenches, fitted equipment and an open roller shutter. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODEL_URLS, TEXTURE_URLS } from './assets.ts';
import { VEHICLE_MODEL_URLS } from './vehicles.ts';
import { Maker, buildBatten, buildBucket, buildCone, buildDrain, buildFan, buildWasher, type Fan, type Washer } from './gear.ts';

/** Bay footprint and clear height, in metres. */
export const BAY={halfWidth:3.0,halfLength:4.7,height:3.6};
/** Where the two drain trenches cross the bay (z). */
const DRAINS=[BAY.halfLength-.95,-(BAY.halfLength-.9)] as const;
type V3=[number,number,number];
/** A spare tip in the holder on the washer. */
export interface NozzleCard {colour:number}
function seeded(seed:number){return ()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};}

/** Texture coordinates in metres from where the surface really is, so tiles line up across separate pieces. */
function metreUV(geometry:THREE.BufferGeometry,size:number){
  const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv');
  for(let i=0;i<p.count;i++){
    const ax=Math.abs(n.getX(i)),ay=Math.abs(n.getY(i)),az=Math.abs(n.getZ(i));
    if(ay>=ax&&ay>=az)uv.setXY(i,p.getX(i)/size,-p.getZ(i)/size);else if(ax>=az)uv.setXY(i,p.getZ(i)/size,p.getY(i)/size);else uv.setXY(i,p.getX(i)/size,p.getY(i)/size);
  }
  uv.needsUpdate=true;return geometry;
}
const WET=`
float bayHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float bayNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(bayHash(i),bayHash(i+vec2(1,0)),f.x),mix(bayHash(i+vec2(0,1)),bayHash(i+vec2(1,1)),f.x),f.y);}
float bayPuddle(vec2 p){float n=bayNoise(p*.9)*.55+bayNoise(p*2.3+7.)*.3+bayNoise(p*6.1+3.)*.15;
  float drains=.2*exp(-abs(p.y-${DRAINS[0].toFixed(3)})*1.6)+.2*exp(-abs(p.y-(${DRAINS[1].toFixed(3)}))*1.6),car=.12*exp(-dot(p*vec2(.55,.3),p*vec2(.55,.3)));
  return smoothstep(.5,.6,n+drains+car);}`;

const GRIME=`
float grimeHash(vec3 p){p=fract(p*.3183099+vec3(.71,.113,.419));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float grimeNoise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
  return mix(mix(mix(grimeHash(i),grimeHash(i+vec3(1,0,0)),f.x),mix(grimeHash(i+vec3(0,1,0)),grimeHash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(grimeHash(i+vec3(0,0,1)),grimeHash(i+vec3(1,0,1)),f.x),mix(grimeHash(i+vec3(0,1,1)),grimeHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float grimeFbm(vec3 p){return grimeNoise(p)*.55+grimeNoise(p*2.3+5.)*.3+grimeNoise(p*5.1+9.)*.15;}`;
/** Years of use on a surface, placed in world space so it runs across separate pieces:
 *  splash  dirt thrown up from the floor, fading out by `splashTop` metres;
 *  streaks runs of dirty water down the surface, strongest just under `streakFrom` metres;
 *  blotch  patches of stain and uneven repainting;
 *  tint    what the dirt turns the surface towards. */
interface Wear {splash?:number; splashTop?:number; streaks?:number; streakFrom?:number; blotch?:number; tint?:[number,number,number];
  /** Dirt packed into joints and creases (where the scan's own occlusion map is dark). */
  joints?:number;
  /** Rust breaking through paint or plating in patches (hangers, straps, pipe paint). */
  rust?:number;
  /** Old leaks on concrete: a darker damp core with a pale salt line round it. */
  damp?:number;
  /** Paint flaked off in sharp-edged patches down to the paler concrete. */
  peel?:number;
  /** An even film of dust and grease over the whole surface (things nobody ever wipes). */
  film?:number;
  /** Paint on pipework lifted and gone in small sharp patches: rusted steel inside, a pale lifted edge round each. */
  flake?:number}
function weather(material:THREE.MeshStandardMaterial, wear:Wear) {
  const {splash=0, splashTop=.5, streaks=0, streakFrom=3.6, blotch=0, tint=[.34,.31,.26], joints=0,
    rust=0, damp=0, peel=0, film=0, flake=0} = wear;
  if (material.userData.weathered || !(splash || streaks || blotch || joints || rust || damp || peel || film || flake)) return material;
  material.userData.weathered = true;

  const f = (n:number) => n.toFixed(3);
  const color = ['#include <map_fragment>', 'float grime=0.;'];
  if (splash || blotch || film || damp || peel || rust || flake) color.push('float grimeFine=grimeFbm(vGrime*11.);');
  if (blotch) color.push('float grimeBig=grimeFbm(vGrime*1.6+3.);');
  if (splash) color.push(`grime+=${f(splash)}*(1.-smoothstep(0.,${f(splashTop)},vGrime.y))*(.45+.55*grimeFine);`);
  if (streaks) color.push(`grime+=${f(streaks)}*smoothstep(.42,.78,grimeFbm(vec3((vGrime.x+vGrime.z)*9.,vGrime.y*.55,2.)))*smoothstep(${f(streakFrom)}-1.6,${f(streakFrom)},vGrime.y)*step(vGrime.y,${f(streakFrom)});`);
  if (blotch) color.push(`grime+=${f(blotch)}*smoothstep(.42,.7,grimeBig)*(.6+.4*grimeFine);`);
  if (joints) color.push(`#ifdef USE_AOMAP
    grime+=${f(joints)}*(1.-smoothstep(.35,.95,texture2D(aoMap,vAoMapUv).r))*(.5+.5*${blotch ? 'grimeBig' : 'grimeFbm(vGrime*1.6+3.)'});
    #endif`);
  if (film) color.push(`grime+=${f(film)}*(.75+.25*grimeFine);`);
  if (splash || streaks || blotch || joints || film) color.push(`
    grime=clamp(grime,0.,1.);
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(${tint.map(f).join(',')})+vec3(${tint.map(v=>f(Math.min(v,1)*.035)).join(',')}),grime);`);

  if (damp) color.push(`
    float grimeLeak=grimeFbm(vGrime*.85+40.)+.08*grimeFine;
    float grimeDamp=${f(damp)}*smoothstep(.56,.7,grimeLeak),grimeSalt=${f(damp)}*smoothstep(.5,.555,grimeLeak)*(1.-smoothstep(.555,.6,grimeLeak));
    diffuseColor.rgb=mix(diffuseColor.rgb*(1.-.45*grimeDamp),diffuseColor.rgb*1.5+vec3(.012,.011,.009),grimeSalt*.6);
    grime=max(grime,grimeDamp*.5);`);
  if (peel) color.push(`
    float grimePeel=${f(peel)}*smoothstep(.66,.675,grimeFbm(vGrime*2.4+21.)+.05*grimeFine);
    diffuseColor.rgb=mix(diffuseColor.rgb,(diffuseColor.rgb*1.55+vec3(.014,.013,.012))*(.85+.3*grimeFine),grimePeel);
    grime=max(grime,grimePeel*.6);`);
  if (rust) color.push(`
    float grimeRust=${f(rust)}*smoothstep(.5,.72,grimeFbm(vGrime*6.5+11.))*(.55+.45*grimeFine);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.3,.13,.05)*(.6+.9*grimeFine),grimeRust);
    grime=max(grime,grimeRust);`);
  if (flake) color.push(`
    float grimeChip=grimeFbm(vGrime*13.+31.)*.8+grimeFbm(vGrime*3.1+17.)*.3+.05*grimeFine;
    float grimeFlake=${f(flake)}*smoothstep(.615,.63,grimeChip),grimeLift=${f(flake)}*smoothstep(.595,.615,grimeChip)*(1.-smoothstep(.615,.63,grimeChip));
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*.55+vec3(.2,.18,.16),grimeLift*.8);
    diffuseColor.rgb=mix(diffuseColor.rgb,mix(vec3(.13,.055,.022),vec3(.33,.15,.055),grimeFine),grimeFlake);
    grime=max(grime,grimeFlake);`);

  const fragment = color.join('\n');
  const before = material.onBeforeCompile, key = material.customProgramCacheKey;
  material.onBeforeCompile=(shader,renderer)=>{
    before?.call(material,shader,renderer);
    shader.vertexShader='varying vec3 vGrime;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGrime=(modelMatrix*vec4(position,1.)).xyz;');
    shader.fragmentShader=`varying vec3 vGrime;${GRIME}\n`+shader.fragmentShader
      .replace('#include <map_fragment>',fragment)
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.92,grime*.75);')
      .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor*=1.-grime*.7;');
  };
  material.customProgramCacheKey=()=>`${key?.call(material)??''}|worn:${[splash,splashTop,streaks,streakFrom,blotch,joints,rust,damp,peel,film,flake,...tint].join(',')}`;
  material.needsUpdate=true;
  return material;
}
function weatherObject(object:THREE.Object3D,wear:Wear){object.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of [o.material].flat())if(m instanceof THREE.MeshStandardMaterial&&!m.transparent&&!m.emissiveMap)weather(m,wear);});}

export class Bay {
  readonly group=new THREE.Group();
  /** Things the player cannot walk through, as floor rectangles (x, z). */
  readonly obstacles:THREE.Box2[]=[];
  readonly ready:Promise<void>;
  /** Where the high-pressure hose leaves the washer. */
  readonly outlet=new THREE.Vector3();
  private readonly fans:Fan[]=[];
  private washer?:Washer;
  private readonly models=new Map<string,THREE.Group>();
  private readonly textures=new Map<string,THREE.Texture>();
  private pressure=0;
  private readonly parked=new Map<string,THREE.Object3D>();
  private sun?:THREE.DirectionalLight;

  constructor(private readonly k:Maker,nozzles:NozzleCard[]){this.lights();this.ready=this.load().then(()=>this.build(nozzles));}

  private async load(){
    const gltf=new GLTFLoader(),images=new THREE.TextureLoader();
    await Promise.all([
      ...Object.entries(MODEL_URLS).map(async([id,url])=>{const scene=(await gltf.loadAsync(url)).scene;
        scene.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=o.receiveShadow=true;this.k.keep(o.geometry);for(const m of [o.material].flat() as THREE.MeshStandardMaterial[]){this.k.keep(m);for(const t of [m.map,m.normalMap,m.roughnessMap,m.metalnessMap,m.aoMap,m.emissiveMap])if(t){t.anisotropy=4;this.k.keep(t);}}}});
        this.models.set(id,scene);}),
      ...(['sedan','van'] as const).map(async id=>{const scene=(await gltf.loadAsync(VEHICLE_MODEL_URLS[id])).scene;scene.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;this.k.keep(o.geometry);for(const m of [o.material].flat() as THREE.Material[])this.k.keep(m);}});this.parked.set(id,scene);}),
      ...Object.entries(TEXTURE_URLS).map(async([id,url])=>{const t=this.k.keep(await images.loadAsync(url));t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;if(id.endsWith('_diff'))t.colorSpace=THREE.SRGBColorSpace;this.textures.set(id,t);}),
    ]);
  }
  /** Scanned surface material; `daylight` makes it read as lit by the sky outside the shop. */
  private surface(id:string,tint=0xffffff,daylight=0,roughness=1){
    const map=this.textures.get(`${id}_diff`)!,arm=this.textures.get(`${id}_arm`)!;
    return this.k.mat(tint,roughness,1,{map,normalMap:this.textures.get(`${id}_nor`)!,aoMap:arm,roughnessMap:arm,metalnessMap:arm,
      ...(daylight?{emissive:new THREE.Color(tint),emissiveMap:map,emissiveIntensity:daylight}:{})});
  }
  /** A flat piece of the shell, given in world space. */
  private wall(width:number,height:number,material:THREE.Material,size:number,position:V3,rotation:V3=[0,0,0]){
    const g=new THREE.PlaneGeometry(width,height);g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),new THREE.Vector3(1,1,1)));
    const m=this.k.mesh(metreUV(g,size),material);this.group.add(m);return m;
  }
  private block(size:V3,material:THREE.Material,texture:number,position:V3,shadow=false){
    const g=new THREE.BoxGeometry(...size);g.translate(...position);const m=this.k.mesh(metreUV(g,texture),material);m.castShadow=shadow;this.group.add(m);return m;
  }
  private prop(id:string,position:V3,rotationY=0,node?:string,scale:number|V3=1){
    const source=this.models.get(id)!,found=node?source.children.find(c=>c.name.endsWith(node)):undefined;
    if(node&&!found)throw Error(`工位模型缺少部件：${id}/${node}`);
    const o=(found??source).clone(true);o.position.set(...position);o.rotation.y=rotationY;if(typeof scale==='number')o.scale.setScalar(scale);else o.scale.set(...scale);
    this.group.add(o);return o;
  }
  private put(o:THREE.Object3D,position:V3,rotationY=0){o.position.set(...position);o.rotation.y=rotationY;this.group.add(o);return o;}
  /** Heights of the upward-facing surfaces straight below a point (shelf boards, cart top). */
  private tops(object:THREE.Object3D,x:number,z:number){
    object.updateMatrixWorld(true);
    const hits=new THREE.Raycaster(new THREE.Vector3(x,3.4,z),new THREE.Vector3(0,-1,0)).intersectObject(object,true),out:number[]=[];
    for(const h of hits){if(!h.face)continue;const up=h.face.normal.clone().transformDirection(h.object.matrixWorld).y;if(up>.6&&!out.some(y=>Math.abs(y-h.point.y)<.04))out.push(h.point.y);}
    return out.sort((a,b)=>a-b);
  }

  private lights(){
    const {height:H}=BAY;
    // The light comes from the LED rows. Most of it arrives as the bay's own reflection map (scene.ts photographs the
    // lit tubes and walls once and lights everything with that picture), which is even and costs nothing per frame;
    // on top, straight-down light for the floor and the tops of things, a little bounce back up onto the slab, and
    // one soft shadow-casting light in the middle so the car and the gear sit on the floor. No lights hang near the
    // walls or the slab, so nothing burns a bright patch onto them. (Area lights looked the same and cost 10 fps.)
    const down=new THREE.DirectionalLight(0xf2f5ff,.85);down.position.set(0,H,0);down.target.position.set(0,0,0);this.group.add(down,down.target);
    this.group.add(new THREE.HemisphereLight(0xe6ecf2,0x6b6f72,.55));
    const key=new THREE.SpotLight(0xf3f6ff,34,9,1.3,1,1.4);key.position.set(0,H-.12,.2);key.target.position.set(0,0,.2);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.radius=9;key.shadow.bias=-.0004;this.group.add(key,key.target);
    const day=new THREE.DirectionalLight(0xfff4e2,1.2);day.position.set(.8,3.5,12);day.target.position.set(0,0,0);this.group.add(day,day.target);
    // The sun on the street, reaching about a metre and a half in through the doorway. Nothing it lights moves, so its
    // shadow is drawn once (and again when the car changes).
    const sun=this.sun=new THREE.DirectionalLight(0xfff1dc,7);sun.position.set(7,19,BAY.halfLength+17);sun.target.position.set(0,0,BAY.halfLength+4);
    sun.castShadow=true;sun.shadow.mapSize.set(4096,4096);sun.shadow.bias=-.0006;sun.shadow.normalBias=.035;sun.shadow.radius=3;sun.shadow.autoUpdate=false;
    const c=sun.shadow.camera;c.left=-18;c.right=18;c.top=14;c.bottom=-14;c.near=1;c.far=60;c.updateProjectionMatrix();this.group.add(sun,sun.target);
  }

  private build(nozzles:NozzleCard[]){
    const {halfWidth:W,halfLength:L,height:H}=BAY,k=this.k,rand=seeded(11);
    /* ---- floor: 300 mm dark tiles kept wet, water standing by the drains and under the car ---- */
    const floor=this.surface('granite_tile',0xb9bcc0);floor.envMapIntensity=1.25;
    floor.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec2 vBayXZ;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBayXZ=(modelMatrix*vec4(position,1.)).xz;');
      shader.fragmentShader=`varying vec2 vBayXZ;${WET}\n`+shader.fragmentShader
        .replace('#include <map_fragment>',`#include <map_fragment>
  float bayWater=bayPuddle(vBayXZ),bayGrit=bayNoise(vBayXZ*7.)*.6+bayNoise(vBayXZ*19.)*.4;
  // Tyre tracks in from the door, grime packed along the walls, old oil spots, soap scum by the drains.
  float bayTrack=exp(-pow((abs(vBayXZ.x)-.78)/.17,2.))*smoothstep(${(-L+.8).toFixed(2)},${(-L+2).toFixed(2)},vBayXZ.y)*(.55+.45*bayGrit);
  float bayEdge=max(1.-smoothstep(0.,.5,${W.toFixed(2)}-abs(vBayXZ.x)),1.-smoothstep(0.,.5,vBayXZ.y+${L.toFixed(2)}))*(.5+.5*bayGrit);
  float bayOil=smoothstep(.66,.8,bayNoise(vBayXZ*1.15+31.))*(1.-smoothstep(1.2,2.4,abs(vBayXZ.x)));
  float bayScum=(exp(-abs(vBayXZ.y-${DRAINS[0].toFixed(3)})*3.2)+exp(-abs(vBayXZ.y-(${DRAINS[1].toFixed(3)}))*3.2))*smoothstep(.35,.7,bayNoise(vBayXZ*4.+9.));
  diffuseColor.rgb*=mix(.8,.5,bayWater)*(1.-.5*bayTrack)*(1.-.6*bayEdge)*(1.-.55*bayOil)*(.82+.3*bayNoise(vBayXZ*.9+4.));
  diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.25,1.05,.8),bayEdge*.5);
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.55,.55,.5),bayScum*.42);`)
        .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(mix(roughnessFactor*.62,.95,clamp(bayEdge*.8+bayScum*.6,0.,1.)),.035,bayWater);roughnessFactor=mix(roughnessFactor,.16,bayOil*(1.-bayWater));')
        .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=normalize(mix(normal,nonPerturbedNormal,bayWater*.92));');
    };
    floor.customProgramCacheKey=()=>'city-wash-floor';
    const drains=DRAINS,trench=.22,edges=[-L,drains[1]-trench/2,drains[1]+trench/2,drains[0]-trench/2,drains[0]+trench/2,L+.3];
    for(let i=0;i<edges.length;i+=2)this.wall(W*2,edges[i+1]-edges[i],floor,1.25,[0,0,(edges[i]+edges[i+1])/2],[-Math.PI/2,0,0]);
    for(const z of drains)this.put(buildDrain(k,W*2,trench),[0,0,z]);

    /* ---- walls: tiles to 1.3 m with a steel capping, dark paint above; slab ceiling ---- */
    const tiles=this.surface('long_white_tiles',0xe4e6e3),paint=this.surface('painted_concrete_02',0x5a5e62),slab=this.surface('painted_concrete_02',0x4a4d50);paint.normalScale.setScalar(.55);slab.normalScale.setScalar(.55);const capping=k.mat(0xa9aeb2,.4,.85);
    tiles.envMapIntensity=.8;
    // Tiles: brown splash line off the floor, dirty joints, runs under the capping. Paint: chalky water marks
    // and patchy repainting (lighter than the paint). Slab: damp patches.
    weather(tiles,{splash:1,splashTop:.75,streaks:.75,streakFrom:1.3,blotch:.3,joints:.9,tint:[.36,.3,.2]});weather(paint,{streaks:.8,streakFrom:H,blotch:.55,splash:.7,splashTop:1.75,tint:[1.75,1.68,1.5]});weather(slab,{blotch:.55,damp:.8,peel:.7,tint:[1.35,1.3,1.2]});
    for(const s of [-1,1]){
      this.wall(L*2,1.3,tiles,1.27,[s*W,.65,0],[0,-s*Math.PI/2,0]);this.wall(L*2,H-1.3,paint,2.6,[s*W,1.3+(H-1.3)/2,0],[0,-s*Math.PI/2,0]);
      this.group.add(k.box([.012,.03,L*2],capping,[s*(W-.006),1.3,0]));
      this.group.add(k.box([.03,.1,L*2],k.mat(0x1b1c1d,.7,0),[s*(W-.015),.05,0]));
    }
    this.wall(W*2,1.3,tiles,1.27,[0,.65,-L]);this.wall(W*2,H-1.3,paint,2.6,[0,1.3+(H-1.3)/2,-L]);
    this.group.add(k.box([W*2,.03,.012],capping,[0,1.3,-L+.006]),k.box([W*2,.1,.03],k.mat(0x1b1c1d,.7,0),[0,.05,-L+.015]));
    /* ---- the slab overhead: black-painted concrete on a grid of downstand beams (three main beams across the bay,
       ribs along it), stained, and lit from below by the tube rows: their light on the soffit is painted once into
       a map (ROWS × tubes), since the tubes themselves are only bright surfaces ---- */
    const rowsZ:number[]=[];for(let z=-(L-.6);z<=L-.5;z+=1.2)rowsZ.push(z);
    const tubesX=[-W+1.35,.1,W-1.15],spanZ=L*2+.6;
    const spill=k.canvas(256,512,c=>{c.fillStyle='#000';c.fillRect(0,0,256,512);c.globalCompositeOperation='lighter';
      for(const z of rowsZ)for(const x of tubesX){const u=(x+W)/(W*2)*256,v=(z+L)/spanZ*512,g=c.createRadialGradient(0,0,0,0,0,1);g.addColorStop(0,'rgba(255,255,255,.5)');g.addColorStop(.35,'rgba(255,255,255,.2)');g.addColorStop(1,'rgba(255,255,255,0)');
        c.save();c.translate(u,v);c.scale(1.5/(W*2)*256,.85/spanZ*512);c.fillStyle=g;c.beginPath();c.arc(0,0,1,0,7);c.fill();c.restore();}});
    spill.colorSpace=THREE.NoColorSpace;spill.channel=1;
    slab.emissive=new THREE.Color(0xf2f5ff);slab.emissiveMap=spill;slab.emissiveIntensity=1;
    {const before=slab.onBeforeCompile,key=slab.customProgramCacheKey;
      slab.onBeforeCompile=(shader,renderer)=>{before.call(slab,shader,renderer);
        // the light landing on the soffit takes the colour of the paint it lands on
        shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance*=diffuseColor.rgb*20.;');};
      slab.customProgramCacheKey=()=>key.call(slab)+'|soffit';}
    const soffit=this.wall(W*2,spanZ,slab,2.6,[0,H,.3],[Math.PI/2,0,0]),uv1=new Float32Array(4*2),at=soffit.geometry.getAttribute('position');
    for(let i=0;i<at.count;i++){uv1[i*2]=(at.getX(i)+W)/(W*2);uv1[i*2+1]=1-(at.getZ(i)+L)/spanZ;}
    soffit.geometry.setAttribute('uv1',new THREE.BufferAttribute(uv1,2));
    const beam=this.surface('painted_concrete_02',0x4a4d50);beam.normalScale.setScalar(.55);weather(beam,{blotch:.55,streaks:.6,streakFrom:H,damp:.7,peel:.6,tint:[1.35,1.3,1.2]});
    const beamsZ=[rowsZ[1]+.6,rowsZ[3]+.6,rowsZ[5]+.6]; // midway between tube rows
    for(const z of beamsZ)this.block([W*2,.42,.3],beam,2.6,[0,H-.21,z]);
    for(const x of [-W+.12,-W*.34,W*.34,W-.12])this.block([.2,.2,L*2],beam,2.6,[x,H-.1,0]);

    /* ---- shop front: piers clad in blue metal slats, header, roller shutter two thirds up, hazard corner guards ---- */
    const slats=this.surface('painted_metal_shutter',0x3a63c4),shutter=this.surface('painted_metal_shutter',0xc9ccce),concrete=this.surface('concrete_wall_008',0xb9b6ae);
    const front=L,pier=.38,depth=.34;
    for(const s of [-1,1]){
      this.block([pier,H,depth],slats,1.1,[s*(W-pier/2),H/2,front+depth/2]);
      const stripes=k.canvas(64,256,c=>{c.fillStyle='#e6b800';c.fillRect(0,0,64,256);c.fillStyle='#141414';for(let y=-64;y<320;y+=64){c.beginPath();c.moveTo(0,y);c.lineTo(64,y+32);c.lineTo(64,y+64);c.lineTo(0,y+32);c.fill();}});
      stripes.wrapT=THREE.RepeatWrapping;stripes.repeat.set(1,3);
      this.group.add(k.box([.07,1.2,.07],k.mat(0xffffff,.6,0,{map:stripes}),[s*(W-pier-.005),.6,front+.035],[0,0,0],.012));
    }
    this.block([W*2,.5,depth],concrete,2.7,[0,H-.25,front+depth/2]);
    this.block([W*2-pier*2,.3,.3],k.mat(0x9da1a5,.5,.6),1,[0,H-.65,front+.17]);
    this.wall(W*2-pier*2-.1,.62,shutter,1.1,[0,H-1.1,front+.2],[0,Math.PI,0]).material.side=THREE.DoubleSide;
    this.group.add(k.box([W*2-pier*2-.1,.06,.035],k.mat(0x8d9296,.45,.8),[0,H-1.43,front+.2]));
    for(const s of [-1,1])this.group.add(k.box([.05,H-.5,.07],k.mat(0x8d9296,.45,.8),[s*(W-pier-.03),(H-.5)/2,front+.2]));

    /* ---- street outside, seen through the opening: pavement, kerb, road, a tiled tenement front opposite with
       shuttered shops, air conditioners and two parked cars. Lit by the sun (lights()) plus a sky fill. ---- */
    const pavement=this.surface('concrete_wall_008',0xd8d5cd,.3),road=this.surface('asphalt_02',0xd0d0d0,.32),kerb=this.surface('concrete_wall_008',0xe6e3dc,.3),facade=this.surface('rounded_square_tiled_wall',0xf0ece2,.7);
    this.wall(60,2.8,pavement,2.7,[0,-.002,front+.3+1.4],[-Math.PI/2,0,0]);this.block([60,.14,.16],kerb,2.7,[0,-.07,front+3.18]);
    this.wall(60,7,road,3,[0,-.13,front+3.26+3.5],[-Math.PI/2,0,0]);this.block([60,.14,.16],kerb,2.7,[0,-.07,front+10.34]);
    this.wall(60,2.4,pavement,2.7,[0,-.002,front+10.42+1.2],[-Math.PI/2,0,0]);
    const paintLine=k.mat(0xe8e2b0,.7,0,{emissive:new THREE.Color(0xe8e2b0),emissiveIntensity:.25});
    for(const z of [front+3.5,front+10.02])this.group.add(k.mesh(new THREE.PlaneGeometry(60,.1),paintLine,[0,-.127,z],[-Math.PI/2,0,0],false));
    const far=front+12.8;this.wall(60,17,facade,1.1,[0,8.5,far],[0,Math.PI,0]);
    const ledge=this.surface('concrete_wall_008',0xbcb8b0,.45);this.block([60,.2,1.4],ledge,2.7,[0,3.55,far-.7],true);
    const glass=k.mat(0x1b2226,.08,.7,{emissive:new THREE.Color(0x3a4a55),emissiveIntensity:.5}),frame=k.mat(0x9a9d9c,.5,.4,{emissive:new THREE.Color(0x9a9d9c),emissiveIntensity:.35}),sill=this.surface('concrete_wall_008',0xcfcac0,.45);
    const boards=[0x3f6257,0x7d4943,0xc9c3b3,0x44546f,0x9c8245,0xc9c3b3,0x3f6257,0x7d4943];
    for(let i=-4;i<4;i++){
      const x=i*3.6+1.8;
      const door=this.prop('rollershutter_door',[x,0,far-.02],Math.PI,undefined,[2.9,1.25,1]);door.traverse(o=>{if(o instanceof THREE.Mesh){const m=(o.material as THREE.MeshStandardMaterial).clone();k.keep(m);m.emissive=new THREE.Color(0xffffff);m.emissiveMap=m.map;m.emissiveIntensity=.4;o.material=m;o.castShadow=false;}});
      this.group.add(k.box([3.3,.62,.12],k.mat(boards[i+4],.6,0,{emissive:new THREE.Color(boards[i+4]),emissiveIntensity:.4}),[x,3.12,far-.1]),k.box([.34,3.45,.3],sill,[x+1.8,1.72,far-.15]));
      for(let floorNo=0;floorNo<4;floorNo++)for(const dx of [-.85,.85]){
        const y=5.1+floorNo*2.9;
        this.group.add(k.box([1.3,1.4,.1],frame,[x+dx,y,far-.03]),k.box([.62,1.26,.12],glass,[x+dx-.31,y,far-.035]),k.box([.6,1.26,.12],glass,[x+dx+.31,y,far-.05]),k.box([1.46,.07,.26],sill,[x+dx,y-.74,far-.12]));
        if((i*7+floorNo*3+(dx>0?1:0))%3===0){const unit=this.prop('exterior_aircon_unit',[x+dx+.05,y-1.12,far-.26],Math.PI);unit.traverse(o=>{if(o instanceof THREE.Mesh)o.castShadow=false;});}
      }
    }
    this.prop('utility_box_02',[5.6,0,far-.45],Math.PI);
    for(const [id,x,z,turn] of [['sedan',-4.6,front+9.25,Math.PI/2],['van',3.9,front+9.3,-Math.PI/2]] as [string,number,number,number][]){const car=this.parked.get(id);if(car)this.put(car,[x,-.13,z],turn);}
    const sky=k.canvas(8,256,c=>{const g=c.createLinearGradient(0,0,0,256);g.addColorStop(0,'#8fb4e0');g.addColorStop(1,'#e6edf2');c.fillStyle=g;c.fillRect(0,0,8,256);});
    const dome=k.mesh(new THREE.PlaneGeometry(200,70),k.keep(new THREE.MeshBasicMaterial({map:sky,fog:false,color:new THREE.Color(1.6,1.6,1.6)})),[0,34,far+6],[0,Math.PI,0],false);this.group.add(dome);

    /* ---- services under the slab, all hung from it: supply duct along the left wall, water pipes along the right,
       a red sprinkler main with branches and heads, a cable ladder, and the tube rows on drop rods ---- */
    // Hundreds of small parts (drop rods, clamps, sprinkler fittings): gathered per material and merged into one mesh each.
    const rodSteel=k.mat(0x9a9fa3,.45,.8),small=new Map<THREE.Material,THREE.Mesh[]>(),add=(...meshes:THREE.Mesh[])=>{for(const m of meshes){const list=small.get(m.material as THREE.Material)??[];list.push(m);small.set(m.material as THREE.Material,list);}};
    const hang=(x:number,y:number,z:number)=>add(k.rod([x,y,z],[x,H,z],.004,rodSteel,5));
    const ductX=-W+.46,ductY=H-.66,ducts=Math.floor((L*2-.1)/1.8);
    for(let i=0;i<ducts;i++){this.prop('modular_airduct_rectangular_01',[ductX,ductY,-L+.02+i*1.8],0,'tripple_01');this.prop('modular_airduct_rectangular_01',[ductX,ductY-.245,-L+.9+i*1.8],0,'brace_01');
      for(const dx of [-.33,.33])hang(ductX+dx,ductY-.24,-L+.9+i*1.8);}
    this.prop('modular_airduct_rectangular_01',[ductX,ductY,-L+.02+ducts*1.8],0,'vent_01');
    const pipes=Math.floor(L*2/1.95),pipeY=H-.56,strap=k.mat(0x6f7478,.5,.8);
    for(let i=0;i<pipes;i++){
      const z=-L+.98+i*1.95;
      this.prop('modular_industrial_pipes_01',[W-.36,pipeY,z],0,'pipe02',[.42,1,.42]).rotation.x=Math.PI/2;
      this.prop('modular_industrial_pipes_01',[W-.62,pipeY+.03,z],0,'pipe02',[.24,1,.24]).rotation.x=Math.PI/2;
      // a trapeze hanger under both pipes
      add(k.box([.5,.02,.04],strap,[W-.47,pipeY-.06,z+.6]));for(const x of [W-.7,W-.24])hang(x,pipeY-.06,z+.6);
    }
    // Sprinklers: a red main down the middle below the beams, a branch at each tube row, pendant heads.
    const red=k.mat(0xa8281f,.42,.35),brass=k.mat(0xb8893c,.34,.92),mainX=.95,mainY=H-.5;
    add(k.rod([mainX,mainY,-L+.05],[mainX,mainY,L-.25],.038,red,14));
    for(let z=-L+.6;z<L-.3;z+=1.9){add(k.rod([mainX,mainY,z-.03],[mainX,mainY,z+.03],.046,red,14),k.box([.1,.012,.03],strap,[mainX,mainY-.04,z]));hang(mainX,mainY+.04,z);}
    for(let i=0;i<rowsZ.length;i+=2){
      const z=rowsZ[i]+.6;add(k.rod([-W+1,mainY,z],[W-1,mainY,z],.021,red,10),k.rod([mainX-.045,mainY,z],[mainX+.045,mainY,z],.045,red,12));
      for(const x of [-W+1.1,-.55,W-1.1]){
        add(k.rod([x,mainY,z],[x,mainY-.07,z],.011,red,8),k.rod([x,mainY-.07,z],[x,mainY-.1,z],.008,brass,8),k.rod([x,mainY-.1,z],[x,mainY-.104,z],.022,brass,12));hang(x,mainY+.02,z);
      }
    }
    // Cable ladder with the bay's wiring lying in it.
    const trayX=-W*.34,trayY=H-.47,tray=k.mat(0xa9aeb2,.5,.75);
    for(const s of [-1,1])add(k.box([.018,.05,L*2-.3],tray,[trayX+s*.15,trayY,0]));
    const rungs=Math.floor((L*2-.3)/.3),rung=new THREE.InstancedMesh(k.keep(new THREE.BoxGeometry(.3,.014,.03)),tray,rungs),place=new THREE.Matrix4();
    for(let i=0;i<rungs;i++){place.makeTranslation(trayX,trayY-.016,-L+.3+i*.3);rung.setMatrixAt(i,place);}rung.castShadow=true;this.group.add(rung);
    [[0x17181a,.011,-.1],[0x17181a,.009,-.06],[0x6a6e72,.012,-.02],[0xb9651f,.008,.03],[0x17181a,.013,.07],[0x2b4f7a,.007,.11]].forEach(([colour,r,dx],n)=>{
      const pts:V3[]=[];for(let i=0;i<=14;i++)pts.push([trayX+dx+Math.sin(i*1.7+n)*.008,trayY-.002+r,-L+.2+i*(L*2-.5)/14]);this.group.add(k.tube(pts,r,k.mat(colour,.7,0),80,6));});
    for(let z=-L+.8;z<L-.3;z+=1.9){add(k.box([.4,.02,.04],strap,[trayX,trayY-.035,z]));for(const dx of [-.19,.19])hang(trayX+dx,trayY-.035,z);}
    // Tube rows, hung a hand's width below the beams' underside; conduit along the slab with a drop to each row.
    const glow=k.keep(new THREE.MeshBasicMaterial({color:new THREE.Color(5,5.2,5.6)})),conduit=k.mat(0x8d9296,.5,.7),tubeY=H-.3;
    // One tube has yellowed with age; all of them work.
    const tired=k.keep(new THREE.MeshBasicMaterial({color:new THREE.Color(4.2,3.9,3.1)}));
    let tube=0;
    for(const z of rowsZ){
      for(const x of tubesX){tube++;this.put(buildBatten(k,1.22,tube===11?tired:glow),[x,tubeY,z]);for(const dx of [-.5,.5])hang(x+dx,tubeY,z);}
      add(k.rod([tubesX[0]-.6,tubeY+.012,z],[tubesX[2]+.6,tubeY+.012,z],.008,conduit,6),k.rod([W-.9,tubeY+.012,z],[W-.9,H-.012,z],.008,conduit,6),k.box([.07,.07,.04],conduit,[W-.9,H-.03,z]));
    }
    add(k.rod([W-.9,H-.012,-(L-.6)],[W-.9,H-.012,L-.6],.011,conduit,6));
    // None of this was put up yesterday: dust and grease film on everything overhead, rust on the hangers, straps and
    // ladder where the plating has gone, the sprinkler paint dulled and rusting at its fittings. Nothing is broken.
    const overhead:[number,number,number]=[.5,.47,.42];
    weather(rodSteel,{film:.45,blotch:.5,rust:.75,tint:overhead});weather(strap,{film:.45,blotch:.5,rust:.8,tint:overhead});weather(tray,{film:.6,blotch:.5,rust:.6,tint:overhead});weather(conduit,{film:.5,blotch:.5,rust:.45,tint:overhead});
    weather(red,{film:.4,blotch:.6,rust:.5,flake:.9,tint:[.6,.52,.45]});
    // The tube fittings' housings (gear.ts buildBatten) have yellowed and taken the same film.
    weather(k.mat(0xc9ccce,.45,.7),{film:.55,blotch:.45,rust:.2,tint:[.62,.57,.47]});
    // The water pipes along the right wall: their paint flaking, rust where it has gone.
    const named=(o:THREE.Object3D,word:RegExp)=>word.test(o.name)||o.children.some(c=>word.test(c.name));
    for(const o of this.group.children)if(named(o,/industrial_pipes/))weatherObject(o,{film:.35,blotch:.6,rust:.5,flake:.9,streaks:.5,streakFrom:H-.3,tint:overhead});
    for(const o of this.group.children)if(named(o,/airduct/))weatherObject(o,{film:.35,blotch:.6,rust:.4,streaks:.5,streakFrom:H-.3,tint:overhead});
    for(const [material,meshes] of small){const one=k.merged(meshes,material);one.castShadow=false;this.group.add(one);}

    /* ---- back-left corner: the washer, its mains box and lead, crate of refills ---- */
    const washer=this.washer=buildWasher(k,nozzles.map(n=>n.colour)),washerAt:V3=[-W+.42,0,-L+1.2],boxX=-W+1.05;
    this.put(washer.group,washerAt,.35);washer.group.updateMatrixWorld(true);this.outlet.copy(washer.outlet).applyMatrix4(washer.group.matrixWorld);
    this.prop('power_box_01',[boxX,1.55,-L+.055],0,undefined);
    const lead=k.mat(0x17181a,.7,0);
    this.group.add(k.tube([[boxX,1.3,-L+.03],[boxX,.5,-L+.03],[boxX-.05,.03,-L+.1],[boxX-.35,.012,-L+.5],[boxX-.5,.012,-L+.9],[boxX-.57,.2,-L+.98]],.0055,lead,60,6));
    this.prop('plastic_crate_02',[-W+.33,0,-L+.3],.05);
    this.prop('plastic_bottle_gallon',[-W+.21,.03,-L+.3],1.7);this.prop('plastic_bottle_gallon',[-W+.45,.03,-L+.29],-1.4);
    const bucket=this.put(buildBucket(k),[W-1.1,0,-L+.26],2.2);
    /* ---- back wall: a steel shelf with what is in use today (nothing on the floor behind the car), work lights ---- */
    const shelfY=1.42,steelShelf=k.mat(0xb4b9bd,.38,.85);
    this.group.add(k.box([1.3,.018,.22],steelShelf,[-.3,shelfY-.009,-L+.11],[0,0,0],.004),k.box([1.3,.05,.012],steelShelf,[-.3,shelfY+.02,-L+.006]));
    for(const x of [-.82,.22])this.group.add(k.box([.02,.16,.02],steelShelf,[x,shelfY-.09,-L+.012]),k.rod([x,shelfY-.17,-L+.02],[x,shelfY-.02,-L+.19],.007,steelShelf,6));
    for(const [id,x,z,turn] of [['all_purpose_cleaner',-.78,.1,.4],['multi_cleaner_bottle',-.56,.12,2.1],['bleach_bottle',-.4,.09,-.5],['multi_cleaner_5_litre',-.08,.1,.1],['lubricant_spray',.18,.11,1.2]] as [string,number,number,number][])this.prop(id,[x,shelfY,-L+z],turn);
    for(const x of [-.72,.32])this.prop('mounted_fluorescent_lights',[x,2.0,-L+.045],0,'lights_a').rotation.x=Math.PI/2;
    // Laminated photo prints stay in the same wall positions; the artwork itself contains no lettering.
    /* ---- right wall: chemical rack, broom, fire alarm, camera ---- */
    const rackAt:V3=[W-.33,0,-L+.95],rack=this.prop('worn_metal_rack',rackAt,-Math.PI/2),shelves=this.tops(rack,rackAt[0],rackAt[2]);
    const stock=[['multi_cleaner_5_litre','multi_cleaner_5_litre','plastic_bottle_gallon','multi_cleaner_5_litre'],['plastic_bottle_gallon','multi_cleaner_5_litre','multi_cleaner_5_litre'],['multi_cleaner_bottle','all_purpose_cleaner','multi_cleaner_bottle','bleach_bottle','all_purpose_cleaner'],['bleach_bottle','lubricant_spray','multi_cleaner_bottle','lubricant_spray']];
    shelves.slice(0,stock.length).forEach((y,row)=>stock[row].forEach((id,i,list)=>{const z=rackAt[2]-.34+(i+.5)*.68/list.length;this.prop(id,[rackAt[0]+.05+(rand()-.5)*.06,y,z+(rand()-.5)*.02],-Math.PI/2+(rand()-.5)*.4);}));
    this.prop('industrial_pastic_container',[-W+.22,0,L-.34],0);
    this.prop('plastic_broom',[W-.12,0,-L+.3],Math.PI);
    this.prop('fire_alarm',[W-.002,1.45,L-.9],-Math.PI/2);
    this.prop('security_camera_01',[W-.25,H-.42,-L+.3],Math.PI*.82).rotation.x=.0;
    /* ---- by the door: cone, wet-floor sign ---- */
    const cone=this.put(buildCone(k),[-W+.68,0,L-.46],.4);this.prop('WetFloorSign_01',[-W+1.08,0,L-.3],.35);
    /* ---- wall fans (running) ---- */
    for(const [x,z,turn] of [[-W,1.4,0],[W,-1.2,Math.PI]] as [number,number,number][]){const fan=buildFan(k);this.put(fan.group,[x,2.62,z],turn);this.fans.push(fan);}

    /* ---- signs of use: cloths drying on a rail, a second bucket and a squeegee, a taped-up notice, dirt on
       whatever stands on the wet floor ---- */
    const rail=k.mat(0x9da2a6,.42,.85),railX=-W+.07,railY=1.52;
    this.group.add(k.rod([railX,railY,-.75],[railX,railY,.55],.009,rail,8));for(const z of [-.75,.55])this.group.add(k.rod([-W,railY,z],[railX,railY,z],.007,rail,6));
    // Microfibre cloths thrown over the rail: each hangs in folds, longer at the front, none of them clean.
    const cloths:[number,number,number][]=[[0x3d6387,-.55,.34],[0xb39a4a,-.2,.3],[0x7e8387,.08,.38],[0x4f7a5c,.36,.27]];
    for(const [colour,z,drop] of cloths){
      const cloth=weather(k.mat(colour,1,0,{side:THREE.DoubleSide}),{blotch:.7,splash:.6,splashTop:1.35,tint:[.42,.38,.3]}),phase=rand()*6;
      for(const side of [-1,1]){
        const height=drop*(side>0?1:.6),g=new THREE.PlaneGeometry(.27,height,14,8),p=g.getAttribute('position');
        for(let i=0;i<p.count;i++){const along=p.getX(i),down=.5-p.getY(i)/height; // 0 at the rail, 1 at the hem
          p.setXYZ(i,along*(1-.12*down),p.getY(i),side*(.012+.018*down)+Math.sin(along*38+phase+side)*.011*down+Math.sin(along*17+phase*2)*.006*down);}
        g.computeVertexNormals();const m=k.mesh(g,cloth,[railX,railY-height/2,z],[0,Math.PI/2,0]);this.group.add(m);
      }
      this.group.add(k.rod([railX,railY+.004,z-.135],[railX,railY+.004,z+.135],.013,cloth,8));
    }
    const spare=this.put(buildBucket(k,0xb5482f),[W-.74,0,-L+.3],.9);spare.scale.setScalar(.92);
    const squeegee=new THREE.Group();squeegee.add(k.rod([0,0,0],[0,1.25,0],.011,k.mat(0xb9bec2,.4,.8),8),k.box([.42,.03,.035],k.mat(0x1b1c1d,.8,0),[0,.015,0]),k.box([.42,.045,.008],k.mat(0x0e0e0f,.95,0),[0,-.012,0]));
    this.put(squeegee,[-W+.09,.03,L-1.65],0);squeegee.rotation.set(.04,0,-.07);
    const note=k.canvas(420,300,c=>{c.fillStyle='#e9e2c8';c.fillRect(0,0,420,300);c.fillStyle='rgba(120,95,40,.18)';for(let n=0;n<40;n++)c.fillRect(rand()*420,rand()*300,30+rand()*90,2+rand()*6);
      c.fillStyle='#1d2a3a';c.textBaseline='middle';c.font='700 62px "PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Microsoft YaHei",sans-serif';c.fillText('收工关水闸',34,96);c.font='600 44px "PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Microsoft YaHei",sans-serif';c.fillText('水枪不要对着人',34,196);
      c.fillStyle='#b9b08f';for(const [x,y] of [[0,0],[340,0],[0,268],[340,268]])c.fillRect(x,y,80,32);});
    this.group.add(k.mesh(new THREE.PlaneGeometry(.3,.214),k.mat(0xffffff,.9,0,{map:note}),[boxX+.53,1.62,-L+.004],[0,0,-.035],false));
    const used:Wear={splash:1,splashTop:.5,blotch:.45,tint:[.3,.26,.2]};
    for(const o of [washer.group,cone,bucket,spare])weatherObject(o,used);
    weather(capping,{blotch:.5,streaks:.3,streakFrom:1.32,tint:[.45,.36,.26]});weather(slats,{splash:.8,splashTop:.9,streaks:.5,streakFrom:H,blotch:.3});weather(shutter,{streaks:.6,streakFrom:H-.7,blotch:.35});

    /* ---- soft contact shadows under what stands on the floor ---- */
    const blob=k.canvas(64,64,c=>{const g=c.createRadialGradient(32,32,2,32,32,32);g.addColorStop(0,'rgba(0,0,0,.85)');g.addColorStop(.55,'rgba(0,0,0,.42)');g.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=g;c.fillRect(0,0,64,64);});
    const shade=k.keep(new THREE.MeshBasicMaterial({map:blob,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,color:0x000000}));
    const contact=(x:number,z:number,w:number,d:number)=>{const m=k.mesh(new THREE.PlaneGeometry(w,d),shade,[x,.004,z],[-Math.PI/2,0,0],false);m.receiveShadow=false;m.renderOrder=1;this.group.add(m);};
    contact(washerAt[0],washerAt[2],.85,.9);contact(rackAt[0],rackAt[2],.9,1.3);contact(-W+.22,L-.34,.6,.9);contact(-W+.33,-L+.3,.7,.6);
    contact(-W+.68,L-.46,.6,.6);contact(-W+1.08,L-.3,.5,.55);contact(W-1.1,-L+.26,.5,.5);contact(W-.74,-L+.3,.46,.46);contact(W-.14,-L+.2,.6,.5);

    this.obstacles.push(
      new THREE.Box2(new THREE.Vector2(-W,-L),new THREE.Vector2(-W+.75,-L+1.5)),   // washer, crate behind it
      new THREE.Box2(new THREE.Vector2(W-.62,-L+.35),new THREE.Vector2(W,-L+1.58)), // rack
      new THREE.Box2(new THREE.Vector2(W-1.3,-L),new THREE.Vector2(W,-L+.46)),       // bucket and broom in the corner
      new THREE.Box2(new THREE.Vector2(-W,L-.68),new THREE.Vector2(-W+1.3,L)),      // tote, cone and wet-floor sign
    );
  }

  /** Redraws the sun's shadow (after the bay is built or the car in it changes). */
  refreshSun(){if(this.sun)this.sun.shadow.needsUpdate=true;}
  /** Fans turn; the washer's gauge rises while the trigger is held. */
  update(dt:number,spraying:boolean){
    for(const fan of this.fans)fan.rotor.rotation.x+=dt*38;
    if(this.washer){this.pressure=THREE.MathUtils.damp(this.pressure,spraying?1:0,spraying?9:4,dt);this.washer.needle.rotation.z=Math.PI*.75-this.pressure*Math.PI*1.05-(spraying?Math.sin(performance.now()*.04)*.02:0);}
  }
}
