/** GPU wash pipeline (rays → hit texels → wash map → dirtiness read-back):
 * the wash map lives on the car's own UV atlas, but every texel is tested in 3D — inside the spray footprint, not
 * hidden behind other geometry (a distance map rendered from the nozzle), within range — so UV seams, back faces and
 * covered panels behave like the real surface. Rates follow rules.texelRate exactly. */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { BRUSH, CLEAN_RATE, PIXEL_DIRTY, angleDensity, distanceFade, type Combined } from './rules.ts';
import type { LoadedVehicle } from './vehicles.ts';

export interface Spray {
  origin:THREE.Vector3;
  /** Spray axes swept during this frame (pointer motion is subdivided so fast sweeps leave no gaps). */
  axes:THREE.Vector3[];
  nozzle:Combined; rotated:boolean; dt:number; time:number;
  /** Per-part multiplier on the cleaning power (soap and its liquid); the last entry is for uncounted surfaces. Absent = 1. */
  factors?:readonly number[];
}
const MAX_POSES=8,LUT=256,DEPTH=512;
const quadVertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;

function lut(values:number[]){
  const t=new THREE.DataTexture(Float32Array.from(values.flatMap(v=>[v,0,0,1])),values.length,1,THREE.RGBAFormat,THREE.FloatType);
  t.magFilter=t.minFilter=THREE.NearestFilter;t.needsUpdate=true;return t;
}
function floatTexture(data:Float32Array,size:number){
  const t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat,THREE.FloatType);
  t.magFilter=t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;t.needsUpdate=true;return t;
}

export class WashGPU {
  readonly size:number;
  readonly partTexture:THREE.DataTexture;
  private readonly renderer:THREE.WebGLRenderer;
  private readonly position:THREE.DataTexture;
  private readonly normal:THREE.DataTexture;
  private initial?:THREE.DataTexture;
  private readonly targets:[THREE.WebGLRenderTarget,THREE.WebGLRenderTarget];
  private current=0;
  private readonly depthTarget=new THREE.WebGLRenderTarget(DEPTH,DEPTH,{type:THREE.HalfFloatType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true});
  private readonly depthScene=new THREE.Scene();
  private readonly depthCamera=new THREE.PerspectiveCamera(30,1,.03,12);
  private readonly depthMaterial:THREE.ShaderMaterial;
  private readonly density=lut(Array.from({length:LUT},(_,i)=>angleDensity(i/(LUT-1))));
  private fade=lut([1]);
  private fadeKey='';
  private factor=lut(Array.from({length:128},()=>1));
  private factorKey='';
  private readonly quad=new FullScreenQuad();
  private readonly washMaterial:THREE.ShaderMaterial;
  private readonly copyMaterial:THREE.ShaderMaterial;
  private readonly clearMaterial:THREE.ShaderMaterial;
  private readonly packMaterial:THREE.ShaderMaterial;
  private readonly saveMaterial:THREE.ShaderMaterial;
  private readonly packTarget:THREE.WebGLRenderTarget;
  private readonly saveTarget:THREE.WebGLRenderTarget;
  private reading=false;

  constructor(renderer:THREE.WebGLRenderer,vehicle:LoadedVehicle){
    this.renderer=renderer;const size=this.size=vehicle.meta.washMap;
    this.position=floatTexture(vehicle.baked.position,size);this.normal=floatTexture(vehicle.baked.normal,size);
    this.partTexture=new THREE.DataTexture(vehicle.partOf,size,size,THREE.RedFormat,THREE.UnsignedByteType);
    this.partTexture.magFilter=this.partTexture.minFilter=THREE.NearestFilter;this.partTexture.needsUpdate=true;
    const target=()=>new THREE.WebGLRenderTarget(size,size,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false,generateMipmaps:false});
    this.targets=[target(),target()];
    this.packTarget=new THREE.WebGLRenderTarget(size/32,size,{type:THREE.UnsignedByteType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false});
    this.saveTarget=new THREE.WebGLRenderTarget(size,size,{type:THREE.UnsignedByteType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false});
    this.depthMaterial=new THREE.ShaderMaterial({side:THREE.DoubleSide,uniforms:{uOrigin:{value:new THREE.Vector3()}},
      vertexShader:`varying vec3 vWorld;void main(){vec4 w=modelMatrix*vec4(position,1.);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader:`uniform vec3 uOrigin;varying vec3 vWorld;void main(){gl_FragColor=vec4(distance(vWorld,uOrigin),0.,0.,1.);}`});
    vehicle.root.updateMatrixWorld(true);
    vehicle.root.traverse(o=>{if(o instanceof THREE.Mesh){const m=new THREE.Mesh(o.geometry,this.depthMaterial);m.matrixAutoUpdate=false;m.matrix.copy(o.matrixWorld);this.depthScene.add(m);}});
    this.washMaterial=new THREE.ShaderMaterial({vertexShader:quadVertex,uniforms:{
      uState:{value:null},uPos:{value:this.position},uNor:{value:this.normal},uDepth:{value:this.depthTarget.texture},uDepthVP:{value:new THREE.Matrix4()},
      uOrigin:{value:new THREE.Vector3()},uMainAxis:{value:new THREE.Vector3()},uCosUnion:{value:0},
      uAxes:{value:Array.from({length:MAX_POSES},()=>new THREE.Vector3())},uRights:{value:Array.from({length:MAX_POSES},()=>new THREE.Vector3())},uUps:{value:Array.from({length:MAX_POSES},()=>new THREE.Vector3())},
      uPoseCount:{value:0},uDt:{value:0},uNow:{value:0},uTime0:{value:0},uRange:{value:1},uHalfH:{value:0},uHalfV:{value:0},uBrush:{value:BRUSH},uK:{value:CLEAN_RATE},
      uPower:{value:0},uTiers:{value:new THREE.Vector3()},uPart:{value:this.partTexture},uFactor:{value:this.factor},uFade:{value:this.fade},uDensity:{value:this.density},uTurbo:{value:0},uTurboAngle:{value:0},uTurboSpeed:{value:0},uSoap:{value:0}},
      fragmentShader:`uniform sampler2D uState,uPos,uNor,uDepth,uFade,uDensity,uPart,uFactor;uniform mat4 uDepthVP;uniform vec3 uOrigin,uMainAxis,uTiers;uniform float uCosUnion;
uniform vec3 uAxes[${MAX_POSES}],uRights[${MAX_POSES}],uUps[${MAX_POSES}];uniform int uPoseCount;
uniform float uDt,uNow,uTime0,uRange,uHalfH,uHalfV,uBrush,uK,uPower,uTurbo,uTurboAngle,uTurboSpeed,uSoap;varying vec2 vUv;
float lut(sampler2D t,float x){return texture2D(t,vec2((clamp(x,0.,1.)*${LUT-1}.+.5)/${LUT}.,.5)).r;}
void main(){
  vec4 s=texture2D(uState,vUv);gl_FragColor=s;
  vec4 P=texture2D(uPos,vUv);if(P.w<.5)return;
  vec3 q=P.xyz-uOrigin;float d=length(q);if(d>uRange||d<.02)return;
  vec3 dir=q/d;if(dot(dir,uMainAxis)<uCosUnion)return;
  vec4 clip=uDepthVP*vec4(P.xyz,1.);if(clip.w<=0.)return;vec2 ndc=clip.xy/clip.w;if(abs(ndc.x)>1.||abs(ndc.y)>1.)return;
  if(d>texture2D(uDepth,ndc*.5+.5).r+.025+.012*d)return;
  float cosI=abs(dot(texture2D(uNor,vUv).xyz,dir));if(cosI<.02)return;
  float brush=atan(uBrush*.5/d),hh=uHalfH+brush,hv=uHalfV+brush,area=4.*d*d*tan(hh)*tan(hv);
  int samples=uTurbo>.5?6:1;float acc=0.;
  for(int i=0;i<${MAX_POSES};i++){if(i>=uPoseCount)break;
    for(int j=0;j<6;j++){if(j>=samples)break;
      vec3 a=uAxes[i],r=uRights[i],u=uUps[i];
      if(uTurbo>.5){float phase=6.2831853*uTurboSpeed*(uTime0+uDt*(float(i*samples+j)+.5)/float(uPoseCount*samples));
        a=normalize(a+(cos(phase)*r+sin(phase)*u)*tan(uTurboAngle));r=normalize(r-a*dot(r,a));u=cross(a,r);}
      float z=dot(q,a);if(z<=0.)continue;
      float fx=abs(atan(dot(q,r),z))/hh,fy=abs(atan(dot(q,u),z))/hv;if(fx>1.||fy>1.)continue;
      acc+=lut(uDensity,fx)*lut(uDensity,fy);
    }
  }
  if(acc<=0.)return;
  float owner=floor(texture2D(uPart,vUv).r*255.+.5);owner=owner>=255.?127.:mod(owner,128.);
  float rate=uK*uPower*lut(uFade,d/uRange)*cosI/area*texture2D(uFactor,vec2((owner+.5)/128.,.5)).r;
  // Alpha remembers when the texel was last hit: positive = by water, negative = by soap (foam sits there until rinsed).
  gl_FragColor=vec4(max(s.rgb-uTiers*rate*acc*uDt/float(uPoseCount*samples),0.),uSoap>.5?-uNow:uNow);
}`});
    this.copyMaterial=new THREE.ShaderMaterial({vertexShader:quadVertex,uniforms:{uSource:{value:null}},fragmentShader:`uniform sampler2D uSource;varying vec2 vUv;void main(){gl_FragColor=texture2D(uSource,vUv);}`});
    this.clearMaterial=new THREE.ShaderMaterial({vertexShader:quadVertex,uniforms:{uState:{value:null},uPart:{value:this.partTexture},uOwner:{value:0}},
      fragmentShader:`uniform sampler2D uState,uPart;uniform float uOwner;varying vec2 vUv;void main(){vec4 s=texture2D(uState,vUv);float p=floor(texture2D(uPart,vUv).r*255.+.5);
        gl_FragColor=(p<255.&&mod(p,128.)==uOwner)?vec4(0.,0.,0.,s.a):s;}`});
    this.packMaterial=new THREE.ShaderMaterial({vertexShader:quadVertex,uniforms:{uState:{value:null},uSize:{value:size},uThreshold:{value:PIXEL_DIRTY}},
      fragmentShader:`uniform sampler2D uState;uniform float uSize,uThreshold;
float bits(float x0,float y){float v=0.;for(int b=0;b<8;b++){vec4 s=texture2D(uState,vec2((x0+float(b)+.5)/uSize,(y+.5)/uSize));if(max(max(s.r,s.g),s.b)>uThreshold)v+=exp2(float(b));}return v/255.;}
void main(){float x0=floor(gl_FragCoord.x)*32.,y=floor(gl_FragCoord.y);gl_FragColor=vec4(bits(x0,y),bits(x0+8.,y),bits(x0+16.,y),bits(x0+24.,y));}`});
    this.saveMaterial=new THREE.ShaderMaterial({vertexShader:quadVertex,uniforms:{uState:{value:null},uInitial:{value:null}},
      fragmentShader:`uniform sampler2D uState,uInitial;varying vec2 vUv;
float q(float now,float start){return start>1e-6?clamp(ceil(now/start*255.-1e-3),0.,255.)/255.:1.;}
void main(){vec3 s=texture2D(uState,vUv).rgb,i=texture2D(uInitial,vUv).rgb;gl_FragColor=vec4(q(s.r,i.r),q(s.g,i.g),q(s.b,i.b),1.);}`});
  }
  /** The live wash map (R dust, G mud, B grease, A last-wet seconds, negative when the last thing to land was soap) for the car's material to sample. */
  get state(){return this.targets[this.current].texture;}
  private pass(material:THREE.ShaderMaterial,target:THREE.WebGLRenderTarget|null){
    const previous=this.renderer.getRenderTarget();this.quad.material=material;this.renderer.setRenderTarget(target);this.quad.render(this.renderer);this.renderer.setRenderTarget(previous);
  }
  /** Starts from `initial`, or from `current` when loading a mask. */
  load(initial:Float32Array,current=initial){
    this.initial?.dispose();this.initial=floatTexture(initial,this.size);
    const source=current===initial?this.initial:floatTexture(current,this.size);
    this.copyMaterial.uniforms.uSource.value=source;this.pass(this.copyMaterial,this.targets[0]);this.current=0;
    if(source!==this.initial)source.dispose();
  }
  wash(spray:Spray){
    const poses=spray.axes.slice(-MAX_POSES);if(!poses.length||spray.dt<=0)return;
    const c=spray.nozzle,u=this.washMaterial.uniforms;
    // Only rebuild the fade table when the nozzle, washer or lance actually changes (not every frame).
    const key=`${c.range}|${c.fade.map(k=>k.time+':'+k.value).join(',')}`;
    if(this.fadeKey!==key){this.fade.dispose();this.fade=lut(Array.from({length:LUT},(_,i)=>distanceFade(c,i/(LUT-1)*c.range)));u.uFade.value=this.fade;this.fadeKey=key;}
    const factors=spray.factors,factorKey=factors?factors.join(','):'';
    if(this.factorKey!==factorKey){this.factor.dispose();this.factor=lut(Array.from({length:128},(_,i)=>!factors?1:i===127?factors[factors.length-1]:factors[i]??factors[factors.length-1]));u.uFactor.value=this.factor;this.factorKey=factorKey;}
    const main=poses.reduce((a,b)=>a.add(b),new THREE.Vector3()).normalize();
    const spread=Math.max(c.horizontal,c.vertical)*Math.PI/360+Math.atan(BRUSH/.1)+(c.turbo?c.turboAngle*Math.PI/180:0);
    const sweep=Math.max(...poses.map(a=>a.angleTo(main)));const half=Math.min(Math.PI*.45,sweep+spread+.03);
    // Distance from the nozzle to every surface it could reach this frame.
    this.depthMaterial.uniforms.uOrigin.value.copy(spray.origin);
    this.depthCamera.position.copy(spray.origin);this.depthCamera.up.set(Math.abs(main.y)>.95?1:0,Math.abs(main.y)>.95?0:1,0);
    this.depthCamera.lookAt(spray.origin.clone().add(main));this.depthCamera.fov=half*360/Math.PI;this.depthCamera.far=c.range+1;this.depthCamera.updateProjectionMatrix();this.depthCamera.updateMatrixWorld();
    const previous=this.renderer.getRenderTarget(),clear=this.renderer.getClearColor(new THREE.Color()),alpha=this.renderer.getClearAlpha();
    this.renderer.setRenderTarget(this.depthTarget);this.renderer.setClearColor(new THREE.Color(1000,0,0),1);this.renderer.clear(true,true,false);
    this.renderer.render(this.depthScene,this.depthCamera);this.renderer.setRenderTarget(previous);this.renderer.setClearColor(clear,alpha);
    u.uDepthVP.value.multiplyMatrices(this.depthCamera.projectionMatrix,this.depthCamera.matrixWorldInverse);
    u.uOrigin.value.copy(spray.origin);u.uMainAxis.value.copy(main);u.uCosUnion.value=Math.cos(half);
    const worldUp=new THREE.Vector3(0,1,0);
    poses.forEach((a,i)=>{
      const right=new THREE.Vector3().crossVectors(a,Math.abs(a.y)>.98?new THREE.Vector3(1,0,0):worldUp).normalize(),up=new THREE.Vector3().crossVectors(right,a).normalize();
      // R turns the fan from a horizontal to a vertical line.
      if(spray.rotated)u.uRights.value[i].copy(up),u.uUps.value[i].copy(right);else u.uRights.value[i].copy(right),u.uUps.value[i].copy(up);
      u.uAxes.value[i].copy(a);
    });
    u.uPoseCount.value=poses.length;u.uDt.value=spray.dt;u.uNow.value=spray.time;u.uTime0.value=spray.time-spray.dt;
    u.uRange.value=c.range;u.uHalfH.value=c.horizontal*Math.PI/360;u.uHalfV.value=c.vertical*Math.PI/360;u.uPower.value=c.power;u.uTiers.value.set(...c.tiers);
    u.uSoap.value=c.soap?1:0;u.uTurbo.value=c.turbo?1:0;u.uTurboAngle.value=c.turboAngle*Math.PI/180;u.uTurboSpeed.value=c.turboSpeed;
    u.uState.value=this.state;this.pass(this.washMaterial,this.targets[1-this.current]);this.current=1-this.current;
  }
  /** A finished part has its remaining dirt cleared. */
  clearPart(owner:number){
    this.clearMaterial.uniforms.uState.value=this.state;this.clearMaterial.uniforms.uOwner.value=owner;
    this.pass(this.clearMaterial,this.targets[1-this.current]);this.current=1-this.current;
  }
  /** One bit per texel: any layer above the original PixelDirtyThreshold. Null while a read is in flight. */
  async dirtyBits(){
    if(this.reading)return null;this.reading=true;
    try{
      this.packMaterial.uniforms.uState.value=this.state;this.pass(this.packMaterial,this.packTarget);
      const out=new Uint8Array(this.size/32*this.size*4);
      await this.renderer.readRenderTargetPixelsAsync(this.packTarget,0,0,this.size/32,this.size,out);return out;
    }finally{this.reading=false;}
  }
  dirtyBitsNow(){
    this.packMaterial.uniforms.uState.value=this.state;this.pass(this.packMaterial,this.packTarget);
    const out=new Uint8Array(this.size/32*this.size*4);this.renderer.readRenderTargetPixels(this.packTarget,0,0,this.size/32,this.size,out);return out;
  }
  /** Remaining fraction of each layer's starting dirt, 0..255 in RGB, for the save file. */
  remainingNow(){
    if(!this.initial)throw Error('清洗现场尚未载入');
    this.saveMaterial.uniforms.uState.value=this.state;this.saveMaterial.uniforms.uInitial.value=this.initial;this.pass(this.saveMaterial,this.saveTarget);
    const out=new Uint8Array(this.size*this.size*4);this.renderer.readRenderTargetPixels(this.saveTarget,0,0,this.size,this.size,out);return out;
  }
  dispose(){
    for(const t of [...this.targets,this.depthTarget,this.packTarget,this.saveTarget])t.dispose();
    for(const t of [this.position,this.normal,this.partTexture,this.density,this.fade,this.factor,this.initial])t?.dispose();
    for(const m of [this.washMaterial,this.copyMaterial,this.clearMaterial,this.packMaterial,this.saveMaterial,this.depthMaterial])m.dispose();
    this.quad.dispose();
  }
}
/** Counts dirty texels per counted part from packed bits (see WashGPU.dirtyBits). */
export function countBits(bits:Uint8Array,partOf:Uint8Array,size:number,parts:number,out=new Uint32Array(parts)){
  out.fill(0);const width=size/32;
  for(let y=0;y<size;y++)for(let px=0;px<width;px++){
    const base=(y*width+px)*4;
    for(let c=0;c<4;c++){let byte=bits[base+c];if(!byte)continue;
      for(let b=0;b<8;b++,byte>>=1){if(!(byte&1))continue;const p=partOf[y*size+px*32+c*8+b];if(p<parts)out[p]++;}}
  }
  return out;
}
