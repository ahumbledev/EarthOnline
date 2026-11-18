/** The wash scene: the bay (bay.ts), the car, the gun in the player's hands, the hose and the water you can see. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { NOZZLES, NOZZLE_ORDER, WASHER_ORDER, combinedNozzle, type LanceId, type NozzleId, type WasherId } from './rules.ts';
import { disposeVehicle, loadVehicle, type LoadedVehicle } from './vehicles.ts';
import { WashGPU } from './gpu.ts';
import { patchMaterial, washUniforms } from './look.ts';
import { BAY, Bay } from './bay.ts';
import { SprayFX } from './water.ts';
import { Hose, Maker, buildCoupler, buildGun, buildStep, type Gun } from './gear.ts';


export { BAY };
/** Equipment dimensions: Kärcher HD-class lance 840 mm; telescopic lance from 1.2 m; quick-connect
 * tip 31 mm with a 24.6 mm coloured collar; rotary nozzle body 41 × 97 mm; two-step platform stands 0.6 m. */
export const GEAR={lance:.84,extension:1.2,tip:.031,collar:.0246,turboLength:.097,turboDiameter:.041,stepHeight:.6,stepTop:[.6,.34] as const};
/** A standing jump lifts the feet about half a metre (an ordinary adult vertical jump is 40–50 cm). */
const JUMP_HEIGHT=.5,GRAVITY=9.8;
/** How far the tip is held off a surface the player aims at from close by, metres: far enough for the fan to open
 * (hand car washes hold the lance 30–50 cm off the paint). Was 0.15. */
const STAND_OFF=.5;
/** Strength of the bay's own reflections once they replace the stand-in studio. */
const ENVIRONMENT=1.5;
const NOZZLE_COLOUR=Object.fromEntries(NOZZLE_ORDER.map(id=>[id,NOZZLES[id].colour])) as Record<NozzleId,number>;
/** How long each lance looks, tip to union nut, metres: 840 mm is the lance an HD-class machine ships with, 1.2 m the
 * shortest telescopic setting; the short and extra-long ones are this build's (no single product measured). */
const LANCE_LENGTH:Record<LanceId,number>={stubby:.84,short:1.0,extension:1.2,xlong:1.8};

export interface Aim {point:THREE.Vector3; distance:number; owner:number; onCar:boolean}

export class WashScene {
  readonly renderer:THREE.WebGLRenderer;
  readonly camera=new THREE.PerspectiveCamera(56,1,.04,60);
  readonly scene=new THREE.Scene();
  readonly uniforms=washUniforms();
  readonly canvas:HTMLCanvasElement;
  vehicle?:LoadedVehicle;
  gpu?:WashGPU;
  yaw=.475; pitch=-.18; onStep=false; crouch=false;
  private readonly raycaster=new THREE.Raycaster();
  private environment:THREE.WebGLRenderTarget;
  private readonly maker=new Maker();
  private readonly bay:Bay;
  private readonly gunParts:Gun;
  private readonly hose:Hose;
  private spraying=false;
  private disposed=false;
  private readonly carSlot=new THREE.Group();
  private readonly gun=new THREE.Group();
  private readonly lance:THREE.Mesh;
  private readonly tips:Record<NozzleId,THREE.Object3D>={} as Record<NozzleId,THREE.Object3D>;
  private readonly stool=new THREE.Group();
  private carBox=new THREE.Box2();
  private readonly spray=new SprayFX();
  private readonly resources:{dispose():void}[]=[];
  private time=0;
  private lanceId:LanceId='stubby';
  private liquidMaterial?:THREE.MeshStandardMaterial;
  /** Jump: height of the feet off the floor and their upward speed. */
  private air=0;
  private rise=0;
  private eyeBase=1.65;
  private nozzle:NozzleId='fan';
  private lift=0;

  constructor(canvas:HTMLCanvasElement){
    this.canvas=canvas;
    // The bay's scans take a moment to arrive: fade the view in when they are up instead of showing an empty room.
    canvas.style.transition='opacity .6s ease';canvas.style.opacity='0';
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.0;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
    this.scene.background=new THREE.Color(0x0b0c0d);
    const pmrem=new THREE.PMREMGenerator(this.renderer),room=new RoomEnvironment();
    this.environment=pmrem.fromScene(room,.03);room.dispose();pmrem.dispose();this.scene.environment=this.environment.texture;this.scene.environmentIntensity=.55;
    this.bay=new Bay(this.maker,NOZZLE_ORDER.map(id=>({colour:NOZZLES[id].colour})));this.scene.add(this.bay.group,this.carSlot);
    this.scene.add(this.spray.group);
    // The gun (gear.ts) with the steel lance tube and the quick-connect tips, which change with the equipment.
    const steel=this.standard(0xb9bec2,.28,.95);
    this.gunParts=buildGun(this.maker);this.gun.add(this.gunParts.group);
    this.lance=new THREE.Mesh(new THREE.CylinderGeometry(.0065,.0065,1,12),steel);this.lance.rotation.x=Math.PI/2;this.resources.push(this.lance.geometry);this.gun.add(this.lance);
    for(const id of NOZZLE_ORDER){
      const tip=new THREE.Group(),colour=this.standard(NOZZLE_COLOUR[id],.4,.1);tip.add(buildCoupler(this.maker));
      if(id==='turbo'){const shell=new THREE.Mesh(new THREE.CylinderGeometry(GEAR.turboDiameter/2,GEAR.turboDiameter/2*.8,GEAR.turboLength,20),colour);shell.rotation.x=Math.PI/2;shell.position.z=-GEAR.turboLength/2;
        const mouth=new THREE.Mesh(new THREE.CylinderGeometry(GEAR.turboDiameter/2*.62,GEAR.turboDiameter/2*.62,.004,20),this.standard(0x060606,.9,0));mouth.rotation.x=Math.PI/2;mouth.position.z=-GEAR.turboLength-.0015;tip.add(shell,mouth);this.resources.push(shell.geometry,mouth.geometry);}
      else if(id==='soap'){ // foam lance head: a wide-mouthed nozzle with the liquid bottle screwed on underneath
        const head=new THREE.Mesh(new THREE.CylinderGeometry(.017,.013,.055,20),colour);head.rotation.x=Math.PI/2;head.position.z=-.0275;
        const mouth=new THREE.Mesh(new THREE.CylinderGeometry(.0135,.0135,.004,20),this.standard(0x060606,.9,0));mouth.rotation.x=Math.PI/2;mouth.position.z=-.056;
        const neck=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.02,14),colour);neck.position.set(0,-.024,-.024);
        this.liquidMaterial=this.standard(0x3d7fc4,.25,0,{transparent:true,opacity:.88});
        const bottle=new THREE.Mesh(new THREE.CylinderGeometry(.03,.032,.1,20),this.liquidMaterial);bottle.position.set(0,-.084,-.024);
        const shoulder=new THREE.Mesh(new THREE.CylinderGeometry(.013,.03,.016,20),this.liquidMaterial);shoulder.position.set(0,-.027,-.024);
        tip.add(head,mouth,neck,shoulder,bottle);this.resources.push(head.geometry,mouth.geometry,neck.geometry,shoulder.geometry,bottle.geometry);}
      else{const collar=new THREE.Mesh(new THREE.CylinderGeometry(GEAR.collar/2,GEAR.collar/2,.014,20),colour);collar.rotation.x=Math.PI/2;collar.position.z=-.007;
        const brass=new THREE.Mesh(new THREE.CylinderGeometry(.006,.008,GEAR.tip-.014,12),this.standard(0xc29a52,.35,.9));brass.rotation.x=Math.PI/2;brass.position.z=-.014-(GEAR.tip-.014)/2;tip.add(collar,brass);this.resources.push(collar.geometry,brass.geometry);}
      tip.visible=id==='fan';this.tips[id]=tip;this.gun.add(tip);
    }
    this.gun.traverse(o=>{if(o instanceof THREE.Mesh)o.castShadow=true;});
    this.scene.add(this.gun);this.setLance('stubby');
    this.hose=new Hose(this.standard(0x141516,.62,0),this.bay.outlet,-BAY.halfWidth+.14);this.hose.mesh.visible=false;this.scene.add(this.hose.mesh);
    // Two-step platform: stands 0.6 m, top 0.6 × 0.34 m.
    this.stool.add(buildStep(this.maker,GEAR.stepHeight,GEAR.stepTop));this.stool.visible=false;this.scene.add(this.stool);
    void this.bay.ready.then(()=>{if(this.disposed)this.maker.resources.forEach(r=>r.dispose());else this.reflectBay();},()=>{this.canvas.style.opacity='1';});
    this.camera.rotation.order="YXZ";this.camera.position.set(BAY.halfWidth-.7,1.65,BAY.halfLength-.5);this.scene.add(this.camera);
    this.resize();
  }
  private standard(colour:number,roughness:number,metalness:number,extra:THREE.MeshStandardMaterialParameters={}){const m=new THREE.MeshStandardMaterial({color:colour,roughness,metalness,...extra});this.resources.push(m);return m;}
  /** Replaces the stand-in studio reflections with the bay itself (its light rows, walls and doorway), seen from
   * where the car stands, so paint, glass and the wet floor reflect the place they are in. */
  private reflectBay(){
    const hidden=[this.carSlot,this.gun,this.spray.group,this.hose.mesh,this.stool].map(o=>[o,o.visible] as const);for(const [o] of hidden)o.visible=false;
    const target=new THREE.WebGLCubeRenderTarget(256,{type:THREE.HalfFloatType}),probe=new THREE.CubeCamera(.05,80,target);probe.position.set(0,1.2,.2);this.scene.add(probe);probe.update(this.renderer,this.scene);this.scene.remove(probe);
    const pmrem=new THREE.PMREMGenerator(this.renderer),next=pmrem.fromCubemap(target.texture);pmrem.dispose();target.dispose();
    this.environment.dispose();this.environment=next;this.scene.environment=next.texture;this.scene.environmentIntensity=ENVIRONMENT;
    for(const [o,visible] of hidden)o.visible=visible;this.hose.mesh.visible=true;this.bay.refreshSun();this.canvas.style.opacity='1';
  }

  /** Puts a shared vehicle in the bay and prepares its wash map. */
  async setVehicle(id:string){
    const [vehicle]=await Promise.all([loadVehicle(id),this.bay.ready]);
    if(this.disposed){disposeVehicle(vehicle);throw Error("The wash bay has closed.");}
    if(this.vehicle)disposeVehicle(this.vehicle);
    this.gpu?.dispose();this.carSlot.clear();
    this.vehicle=vehicle;this.gpu=new WashGPU(this.renderer,vehicle);
    this.uniforms.uWashState.value=this.gpu.state;this.uniforms.uWashPart.value=this.gpu.partTexture;
    const patched=new Set<THREE.Material>();
    vehicle.root.traverse(o=>{if(o instanceof THREE.Mesh){
      const m=o.material as THREE.MeshStandardMaterial;
      if(o.geometry.getAttribute('uv')&&!patched.has(m)){patchMaterial(m,this.uniforms,m.transparent);patched.add(m);}
    }});
    this.carSlot.add(vehicle.root);this.bay.refreshSun();
    const [w,,l]=vehicle.meta.dimensions;
    this.carBox=new THREE.Box2(new THREE.Vector2(-w/2-.22,-l/2-.22),new THREE.Vector2(w/2+.22,l/2+.22));
    this.stool.position.set(-(w/2+.62),0,-.2);
    return vehicle;
  }
  setStepVisible(visible:boolean){this.stool.visible=visible;if(!visible)this.onStep=false;}
  setNozzle(id:NozzleId){this.nozzle=id;for(const k of Object.keys(this.tips) as NozzleId[])this.tips[k].visible=k===id;}
  /** Colour of the liquid in the foam bottle. */
  setLiquid(colour:number){this.liquidMaterial?.color.setHex(colour);}
  setLance(lance:LanceId|boolean){
    this.lanceId=typeof lance==='boolean'?(lance?'extension':'stubby'):lance;const length=LANCE_LENGTH[this.lanceId];
    this.lance.scale.y=length;this.lance.position.z=-.22-length/2;
    for(const tip of Object.values(this.tips))tip.position.z=-.22-length;
  }
  toggleStep(){
    if(!this.stool.visible)return false;
    if(Math.hypot(this.camera.position.x-this.stool.position.x,this.camera.position.z-this.stool.position.z)>1.1)return false;
    this.onStep=!this.onStep;if(this.onStep)this.camera.position.set(this.stool.position.x,this.camera.position.y,this.stool.position.z);return true;
  }
  move(keys:Set<string>,dt:number){
    const forward=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
    const strafe=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
    this.crouch=keys.has('KeyC');
    if((forward||strafe)&&!this.onStep){
      const length=Math.hypot(forward,strafe),speed=1.6*dt/length;
      const dx=(-Math.sin(this.yaw)*forward+Math.cos(this.yaw)*strafe)*speed,dz=(-Math.cos(this.yaw)*forward-Math.sin(this.yaw)*strafe)*speed;
      const p=this.camera.position;if(this.canStand(p.x+dx,p.z))p.x+=dx;if(this.canStand(p.x,p.z+dz))p.z+=dz;
    }
    const eye=(this.crouch?1.02:1.65)+(this.onStep?GEAR.stepHeight:0);
    // Space jumps under gravity.
    if(keys.has('Space')&&this.air===0&&this.rise===0&&!this.crouch&&!this.onStep)this.rise=Math.sqrt(2*GRAVITY*JUMP_HEIGHT);
    if(this.rise!==0||this.air>0){this.air+=this.rise*dt;this.rise-=GRAVITY*dt;if(this.air<=0){this.air=0;this.rise=0;}}
    this.eyeBase=THREE.MathUtils.damp(this.eyeBase,eye,14,dt);this.camera.position.y=this.eyeBase+this.air;this.camera.rotation.set(this.pitch,this.yaw,0);
  }
  private canStand(x:number,z:number){
    const r=.28;
    return Math.abs(x)<BAY.halfWidth-r&&z>-BAY.halfLength+r&&z<BAY.halfLength-.2
      &&![this.carBox,...this.bay.obstacles,...(this.stool.visible?[new THREE.Box2(new THREE.Vector2(this.stool.position.x-.32,this.stool.position.z-.2),new THREE.Vector2(this.stool.position.x+.32,this.stool.position.z+.36))]:[])]
        .some(b=>x>b.min.x-r&&x<b.max.x+r&&z>b.min.y-r&&z<b.max.y+r);
  }
  /** What the pointer is over: a point on the car (with its owning part) or on the bay. */
  aim(x:number,y:number):Aim{
    this.camera.updateMatrixWorld();this.raycaster.setFromCamera(new THREE.Vector2(x,y),this.camera);
    return this.rayAim();
  }
  private rayAim():Aim{
    const hit=this.vehicle?this.raycaster.intersectObject(this.vehicle.root,true)[0]:undefined;
    if(hit){
      let owner=-1;const uv=hit.uv;
      if(uv&&(hit.object as THREE.Mesh).geometry.getAttribute('uv')&&this.vehicle){const s=this.vehicle.meta.washMap,v=this.vehicle.partOf[Math.min(s-1,Math.floor(uv.y*s))*s+Math.min(s-1,Math.floor(uv.x*s))];owner=v===255?-1:v&127;}
      return {point:hit.point,distance:hit.distance,owner,onCar:true};
    }
    const far=this.raycaster.ray.at(6,new THREE.Vector3());
    const floor=this.raycaster.ray.direction.y<-.01?this.raycaster.ray.origin.y/-this.raycaster.ray.direction.y:Infinity;
    return {point:floor<6?this.raycaster.ray.at(floor,new THREE.Vector3()):far,distance:Math.min(floor,6),owner:-1,onCar:false};
  }
  /** Gun follows the aim; returns where the water leaves the tip. Reaching over a roof lifts the lance overhead
   * (hands up to 0.3 m above the eyes), and a target closer than the lance pulls the gun back so the tip stays
   * STAND_OFF off the paint instead of passing into the car. */
  aimGun(target:THREE.Vector3,dt=1/60){
    const hand=new THREE.Vector3(.22,-.31,-.46).applyMatrix4(this.camera.matrixWorld);
    const want=THREE.MathUtils.clamp(target.y+.35-hand.y,0,this.camera.position.y+.3-hand.y);
    this.lift=THREE.MathUtils.damp(this.lift,want,8,dt);hand.y+=this.lift;
    const reach=LANCE_LENGTH[this.lanceId]+.22+(this.nozzle==='turbo'?GEAR.turboLength:this.nozzle==='soap'?.056:GEAR.tip);
    const toTarget=target.clone().sub(hand),d=toTarget.length();
    if(d<reach+STAND_OFF&&d>1e-4)hand.addScaledVector(toTarget.divideScalar(d),d-(reach+STAND_OFF));
    this.gun.position.copy(hand);this.gun.lookAt(target);this.gun.rotateY(Math.PI);if(this.spraying){this.gun.rotateZ(Math.sin(this.time*83)*.007);this.gun.rotateX(Math.sin(this.time*61)*.0035);this.gun.translateZ(.012+Math.sin(this.time*47)*.0025);}
    this.gun.updateMatrixWorld();
    const eye=this.camera.position,sin=Math.sin(this.yaw),cos=Math.cos(this.yaw);
    this.hose.update(this.gunParts.inlet.getWorldPosition(new THREE.Vector3()),new THREE.Vector3(eye.x+cos*.2+sin*.3,0,eye.z-sin*.2+cos*.3),this.carBox);
    return new THREE.Vector3(0,0,-reach).applyMatrix4(this.gun.matrixWorld);
  }
  nozzleSettings(nozzle:NozzleId,washer:WasherId|boolean){return combinedNozzle(nozzle,washer,this.lanceId);}
  /** Draws the water from `tip` toward `target` (null = not spraying). */
  water(tip:THREE.Vector3,target:THREE.Vector3|null,nozzle:NozzleId,rotated:boolean,washer:WasherId|boolean,dt:number){
    this.spraying=!!target;
    this.gunParts.trigger.rotation.x=THREE.MathUtils.damp(this.gunParts.trigger.rotation.x,target?-.17:0,30,dt);
    const c=combinedNozzle(nozzle,washer,this.lanceId),rank=typeof washer==='boolean'?(washer?2:0):WASHER_ORDER.indexOf(washer);
    this.spray.update(tip,target,{horizontal:c.horizontal,vertical:c.vertical,cone:c.turbo?c.turboAngle:0,foam:c.soap,force:.4+rank*.25},rotated,dt);
  }
  frame(dt:number){
    this.time+=dt;this.uniforms.uWashTime.value=this.time;
    if(this.gpu)this.uniforms.uWashState.value=this.gpu.state;
    this.bay.update(dt,this.spraying);
    this.renderer.render(this.scene,this.camera);
  }
  get clock(){return this.time;}
  /** Feet off the floor, metres (0 when standing). */
  get airborne(){return this.air;}
  /** Size on screen, in CSS pixels, of a spray footprint `width` × `height` metres across at `point`. */
  footprintPixels(point:THREE.Vector3,width:number,height:number){
    const distance=Math.max(.2,point.distanceTo(this.camera.position)),scale=this.canvas.clientHeight/(2*distance*Math.tan(this.camera.fov*Math.PI/360));
    return {width:width*scale,height:height*scale};
  }
  /** Renders a fixed three-quarter view for the before/after comparison. */
  snapshot(){
    const keep={p:this.camera.position.clone(),yaw:this.yaw,pitch:this.pitch},gun=this.gun.visible,hose=this.hose.mesh.visible;
    const l=this.vehicle?.meta.dimensions[2]??4.5;
    this.camera.position.set(2.1,1.6,l/2+1.2);this.camera.lookAt(0,.7,0);this.gun.visible=this.hose.mesh.visible=this.spray.group.visible=false;
    this.frame(0);const image=this.canvas.toDataURL('image/webp',.86);
    this.camera.position.copy(keep.p);this.yaw=keep.yaw;this.pitch=keep.pitch;this.camera.rotation.set(this.pitch,this.yaw,0);this.gun.visible=gun;this.hose.mesh.visible=hose;this.spray.group.visible=true;
    return image;
  }
  resize(){const w=this.canvas.clientWidth,h=this.canvas.clientHeight;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.spray.setViewport(this.renderer.domElement.height,this.camera.fov);}
  dispose(){this.disposed=true;this.renderer.setAnimationLoop(null);if(this.vehicle)disposeVehicle(this.vehicle);this.gpu?.dispose();this.resources.forEach(r=>r.dispose());this.maker.resources.forEach(r=>r.dispose());this.spray.dispose();this.hose.dispose();this.environment.dispose();this.renderer.dispose();this.renderer.forceContextLoss();}
}
