import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPlayerController } from '../exploration/player.ts';
import { createFollowCamera } from '../exploration/follow-camera.ts';
import { readDrivingInput } from '../exploration/vehicle-controls.ts';
import { createWorldClock, sampleDaylight } from '../exploration/time.ts';
import { createCityPresence } from '../multiplayer/public-presence.ts';
import { loadWalkingAvatar } from '../avatar/walking.ts';
import type { CityMap, Point } from '../maps/index.ts';
import { createDistrict } from './geometry.ts';

function freeObject(group: THREE.Object3D) {
  const materials=new Set<THREE.Material>(), geometries=new Set<THREE.BufferGeometry>();
  group.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);for(const m of (Array.isArray(o.material)?o.material:[o.material]))materials.add(m);}});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());group.removeFromParent();
}
function streetDirection(map:CityMap, spawn:Point) {
  let best=Infinity, yaw=0;
  for(const road of map.roads) for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=dx*dx+dz*dz;
    if(!len)continue;
    const t=THREE.MathUtils.clamp(((spawn[0]-a[0])*dx+(spawn[1]-a[1])*dz)/len,0,1);
    const d=(a[0]+dx*t-spawn[0])**2+(a[1]+dz*t-spawn[1])**2;
    if(d<best){best=d;yaw=Math.atan2(dx,dz);}
  }
  return yaw;
}
export type ViewMode='overview'|'walk';
export async function openDistrict(map:CityMap, renderer:THREE.WebGLRenderer, say:(message:string)=>void,character:'male'|'female'='male'){
  const district=createDistrict(map,renderer),scene=new THREE.Scene();
  const [sx,sz]=map.spawn,spawn=new THREE.Vector3(sx,.12,sz);
  const roadYaw=streetDirection(map,map.spawn);
  const carOrigin=new THREE.Vector3(sx+2.35*Math.cos(roadYaw),.15,sz-2.35*Math.sin(roadYaw));
  scene.add(district.root);
  const avatar=await loadWalkingAvatar(character);
  let player;
  try{player=await createPlayerController(district.solids,spawn,avatar);}
  catch(error){avatar.dispose();district.dispose();throw error;}
  const body=player;
  scene.add(body.object);
  const car=body.addVehicle({id:'car',position:carOrigin,rotation:roadYaw,config:{length:5.03,width:2.09,height:1.42}});
  const carGroup=new THREE.Group();scene.add(carGroup);
  let disposed=false;
  new GLTFLoader().load('/vehicles/sedan.glb',gltf=>{
    if(disposed){freeObject(gltf.scene);return;}carGroup.add(gltf.scene);
  },undefined,()=>say('车辆外观加载失败，请重新载入城市'));
  const sun=new THREE.DirectionalLight('#fff0d8',2.2),sky=new THREE.HemisphereLight('#e2eeea','#b09e8f',1.8);
  scene.add(sun,sky);
  const fog = new THREE.FogExp2(0xbacbca, .0012);
  scene.fog = fog;
  let elapsed = 0;
  const clock=createWorldClock(15.5);clock.setPaused(true);
  const camera=new THREE.PerspectiveCamera(52,1,.16,8000), follow=createFollowCamera((a,b)=>body.constrainCamera(a,b));
  const focus=new THREE.Vector3(sx,0,sz), target=new THREE.Vector3(),direction=new THREE.Vector3();
  let mode:ViewMode='overview',yaw=roadYaw+.65, pitch=.75, distance=152;
  let presence:ReturnType<typeof createCityPresence>|undefined, online=false;
  const peers=new Map<string,THREE.Mesh>();
  const peerGeometry=new THREE.CapsuleGeometry(.24,1.18,4,8);
  const peerMaterial=new THREE.MeshStandardMaterial({color:'#377980'});
  function peersUpdate(){
    const v=body.horizontalVelocity;
    presence?.update({x:body.position.x,y:body.position.y,z:body.position.z,yaw:body.object.rotation.y,moving:v.lengthSq()>.01,sprinting:body.sprinting});
    const poses=presence?.peers();
    for(const [id,o] of peers){if(!poses?.has(id)){o.removeFromParent();peers.delete(id);}}
    for(const [id,p] of poses??[]){
      let o=peers.get(id);if(!o){o=new THREE.Mesh(peerGeometry,peerMaterial);scene.add(o);peers.set(id,o);}
      o.position.set(p.x,p.y+.83,p.z);o.rotation.y=p.yaw;
    }
  }
  function view(next:ViewMode){
    if(mode===next)return;
    mode=next;focus.copy(body.position);pitch=next==='overview'?.76:.28;follow.snap();body.stopHorizontalMotion();
    if(next==='walk')yaw=roadYaw+Math.PI;
  }
  function drive(){
    if(body.drivingVehicle){const result=body.exitVehicle();say(result.ok?'已下车':'先停车，再到有空间的一侧下车');return;}
    const result=body.enterVehicle('car');
    if(result.ok){view('walk');yaw=roadYaw+Math.PI;say('W / S 加减速 · A / D 转向 · 空格手刹');}
    else say(result.reason==='too-far'?'请走近起点的车辆，或点击「回到起点」':'请稍候，在车辆停稳后上车');
  }
  function reset(){
    if(body.drivingVehicle){body.resetVehicle('car',carOrigin,new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),roadYaw));}
    else{body.teleport(spawn);body.resetVehicle('car',carOrigin,new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),roadYaw));}
    focus.copy(spawn);follow.snap();say('已回到起点');
  }
  function render(dt:number,keys:ReadonlySet<string>,jump:boolean){
    const dark=sampleDaylight(clock.hour), night=dark.night;
    elapsed += dt;
    sun.position.set(...dark.sunDirection).multiplyScalar(320);
    sun.intensity=.12+2.4*dark.daylight;sky.intensity=.75+1.3*dark.daylight;district.night.value=night;
    const forward=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
    const sideways=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
    direction.set(-Math.sin(yaw)*forward+Math.cos(yaw)*sideways,0,-Math.cos(yaw)*forward-Math.sin(yaw)*sideways);
    if(direction.lengthSq()>1)direction.normalize();
    if(body.drivingVehicle){body.setVehicleInput('car',readDrivingInput(keys,new Set(),car.speedMps,mode==='walk')); }
    if(mode==='overview'){
      focus.addScaledVector(direction,dt*distance*.65);
      focus.x=THREE.MathUtils.clamp(focus.x,map.bounds[0],map.bounds[2]);focus.z=THREE.MathUtils.clamp(focus.z,map.bounds[1],map.bounds[3]);
      direction.set(0,0,0);
    }
    body.update(dt,direction,keys.has('ShiftLeft')||keys.has('ShiftRight'),jump&&mode==='walk'&&!body.drivingVehicle);
    if(body.position.y < -10 || body.position.x < map.bounds[0]-8 || body.position.x > map.bounds[2]+8 || body.position.z < map.bounds[1]-8 || body.position.z > map.bounds[3]+8)reset();
    carGroup.position.copy(car.render.position);carGroup.quaternion.copy(car.render.quaternion);
    if(mode==='walk'){
      follow.update(camera,dt,{feet:body.renderPosition,height:body.drivingVehicle?1.8:1.45,yaw,pitch,grounded:body.grounded, distance:body.drivingVehicle?8.5:4.8,landingSpeed:body.landingSpeed});
    }else{
      target.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));
      camera.position.copy(focus).addScaledVector(target,distance);camera.lookAt(focus);
    }
    camera.aspect=renderer.domElement.clientWidth/Math.max(1,renderer.domElement.clientHeight);camera.updateProjectionMatrix();
    const look = district.updateLook(dark.sunDirection, night, elapsed, camera.position, clock.hour);
    fog.color.copy(look.haze); fog.density = look.hazeDensity;
    peersUpdate();renderer.render(scene,camera);
  }
  return {render,view,drive,reset,get mode(){return mode;},get driving(){return Boolean(body.drivingVehicle);},get night(){return clock.hour>18;},get connected(){return online;},
    get enabled(){return !!presence;},get speed(){return Math.round(Math.abs(car.speedKph));},
    get position(){return mode==='overview'?focus:body.position;},
    rotate(dx:number,dy:number){yaw-=dx*.006;pitch=THREE.MathUtils.clamp(pitch+dy*.004,mode==='overview'?.25:-.45,1.45);},
    zoom(delta:number){if(mode==='overview')distance=THREE.MathUtils.clamp(distance*Math.exp(delta*.001),30,1800);},
    time(){clock.setHour(clock.hour>18?15.5:22);},
    togglePeers(){if(presence){presence.dispose();presence=undefined;online=false;}else presence=createCityPresence('/presence',map.id,ok=>{online=ok;say(ok?'已连接同城玩家':'联机服务未连接，可继续单人探索');});},
    dispose(){disposed=true;presence?.dispose();peerGeometry.dispose();peerMaterial.dispose();body.dispose();freeObject(carGroup);district.dispose();scene.clear();}
  };
}
