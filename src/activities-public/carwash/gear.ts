/** Procedural pressure washer, lance, hose, bay fittings and props. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type V3=[number,number,number];

/** Builds meshes and remembers what has to be disposed. */
export class Maker {
  readonly resources:{dispose():void}[]=[];
  private readonly cache=new Map<string,THREE.MeshStandardMaterial>();
  mat(colour:number,roughness:number,metalness=0,extra:THREE.MeshStandardMaterialParameters={}){
    const key=Object.keys(extra).length?'':`${colour}|${roughness}|${metalness}`,hit=key&&this.cache.get(key);if(hit)return hit;
    const m=new THREE.MeshStandardMaterial({color:colour,roughness,metalness,...extra});this.resources.push(m);if(key)this.cache.set(key,m);return m;
  }
  keep<T extends {dispose():void}>(resource:T){this.resources.push(resource);return resource;}
  mesh(geometry:THREE.BufferGeometry,material:THREE.Material,position:V3=[0,0,0],rotation:V3=[0,0,0],shadow=true){
    const m=new THREE.Mesh(this.keep(geometry),material);m.position.set(...position);m.rotation.set(...rotation);m.castShadow=shadow;m.receiveShadow=true;return m;
  }
  box(size:V3,material:THREE.Material,position:V3=[0,0,0],rotation:V3=[0,0,0],radius=0){
    return this.mesh(radius?new RoundedBoxGeometry(size[0],size[1],size[2],3,Math.min(radius,Math.min(...size)/2-1e-4)):new THREE.BoxGeometry(...size),material,position,rotation);
  }
  /** Cylinder between two points. */
  rod(a:V3,b:V3,radius:number,material:THREE.Material,segments=10){
    const from=new THREE.Vector3(...a),to=new THREE.Vector3(...b),m=this.mesh(new THREE.CylinderGeometry(radius,radius,from.distanceTo(to),segments),material);
    m.position.copy(from).add(to).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),to.sub(from).normalize());return m;
  }
  tube(points:V3[],radius:number,material:THREE.Material,segments=48,radial=8){
    return this.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),false,'centripetal'),segments,radius,radial),material);
  }
  /** Surface of revolution around +Y from (radius, height) pairs. */
  lathe(profile:[number,number][],material:THREE.Material,segments=28){
    return this.mesh(new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),segments),material);
  }
  /** One mesh out of many small ones (wire cages, grates). */
  merged(parts:THREE.Mesh[],material:THREE.Material){
    const geometries=parts.map(p=>{p.updateMatrix();const g=p.geometry.clone().applyMatrix4(p.matrix);return g.index?g.toNonIndexed():g;});
    const out=this.mesh(mergeGeometries(geometries)!,material);geometries.forEach(g=>g.dispose());return out;
  }
  canvas(width:number,height:number,draw:(c:CanvasRenderingContext2D)=>void){
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;draw(canvas.getContext('2d')!);
    const t=this.keep(new THREE.CanvasTexture(canvas));t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t;
  }
}

/* ------------------------------------------------------------------ trigger gun ------------------------------------------------------------------ */

export interface Gun {group:THREE.Group; trigger:THREE.Group; inlet:THREE.Object3D}
/** Trigger gun in gun space: −Z forward, +Y up, origin at the top of the grip; the lance thread sits at z = −0.22.
 * Proportions after an industrial trigger gun (grip, long trigger lever inside a hand guard, swivel inlet under the grip). */
export function buildGun(k:Maker):Gun {
  const group=new THREE.Group(),shell=k.mat(0x1b1d20,.58,.04),soft=k.mat(0x2c3035,.9,0),steel=k.mat(0xb9bec2,.28,.95),brass=k.mat(0xb8893c,.34,.92),red=k.mat(0xb3221b,.5,.05);
  // Side profile (forward, up) extruded across the hand.
  const side=(points:[number,number][],depth:number,bevel:number)=>{
    const shape=new THREE.Shape();shape.moveTo(...points[0]);for(const p of points.slice(1))shape.lineTo(...p);shape.closePath();
    const g=new THREE.ExtrudeGeometry(shape,{depth:depth-bevel*2,bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelSegments:3,curveSegments:8});
    g.translate(0,0,-(depth-bevel*2)/2);g.rotateY(Math.PI/2);return g;
  };
  // Valve body: a round barrel; under it the trigger housing; behind it the grip, rounded to sit in a hand.
  const barrel=k.mesh(new THREE.CapsuleGeometry(.0195,.2,8,18),shell,[0,0,-.085],[Math.PI/2,0,0]);group.add(barrel);
  group.add(k.mesh(side([[.132,-.01],[.128,-.03],[.05,-.034],[.02,-.01]],.024,.004),shell));
  // Grip: a moulded handle, oval in section, raked back.
  const grip=k.mesh(new THREE.CapsuleGeometry(.02,.1,8,18),shell,[0,-.078,.004],[-.2,0,0]);grip.scale.set(.82,1,1.12);group.add(grip);
  const pad=k.mesh(new THREE.CapsuleGeometry(.0185,.074,6,16),soft,[0,-.082,.0105],[-.2,0,0]);pad.scale.set(.74,1,1.12);group.add(pad);
  // Trigger lever, hinged at the front; squeezed toward the grip while water runs.
  const trigger=new THREE.Group();trigger.position.set(0,-.03,-.118);
  const lever=k.mesh(side([[.006,.004],[-.004,0],[-.07,-.07],[-.078,-.088],[-.066,-.092],[-.05,-.068]],.014,.002),k.mat(0x3a3f45,.5,.15));trigger.add(lever);group.add(trigger);
  // Hand guard from the nose round to the foot of the grip.
  group.add(k.tube([[0,-.026,-.13],[0,-.07,-.136],[0,-.122,-.108],[0,-.148,-.055],[0,-.143,-.008]],.0042,shell,28,8));
  // Safety latch on the trigger.
  trigger.add(k.box([.016,.008,.012],red,[0,-.052,.05],[.75,0,0],.002));
  // Swivel inlet under the grip: brass swivel, hex nut, hose ferrule.
  const down=new THREE.Vector3(0,-.98,.2).normalize(),foot=new THREE.Vector3(0,-.142,.014),at=(d:number):V3=>foot.clone().addScaledVector(down,d).toArray() as V3;
  group.add(k.rod(at(0),at(.03),.0105,brass,14),k.rod(at(.03),at(.043),.0135,steel,6),k.rod(at(.043),at(.075),.0098,steel,12));
  const inlet=new THREE.Object3D();inlet.position.set(...at(.07));group.add(inlet);
  // Lance: union nut, ribbed insulated sleeve (the steel tube itself is added by the scene, it changes length).
  group.add(k.rod([0,0,-.2],[0,0,-.232],.0155,steel,6));
  const ribs:[number,number][]=[[.0001,0],[.0118,0],[.013,.004]];for(let y=.012;y<.25;y+=.022)ribs.push([.013,y],[.0118,y+.003],[.0118,y+.008],[.013,y+.011]);ribs.push([.013,.262],[.0105,.27],[.0001,.27]);
  const sleeve=k.lathe(ribs,k.mat(0x131416,.82,0),18);sleeve.rotation.x=-Math.PI/2;sleeve.position.z=-.234;group.add(sleeve);
  return {group,trigger,inlet};
}
/** Quick-connect coupler that every tip plugs into; local −Z forward, ends at z = 0 where the tip starts. */
export function buildCoupler(k:Maker){
  const g=new THREE.Group(),steel=k.mat(0xc4c8cb,.3,.95),brass=k.mat(0xb8893c,.34,.92);
  g.add(k.rod([0,0,.05],[0,0,.03],.0085,brass,6),k.rod([0,0,.03],[0,0,.004],.0108,steel,16),k.rod([0,0,.022],[0,0,.012],.0122,steel,16),k.rod([0,0,.004],[0,0,0],.0095,steel,16));
  return g;
}

/* ------------------------------------------------------------------ pressure washer ------------------------------------------------------------------ */

export interface Washer {group:THREE.Group; needle:THREE.Mesh; outlet:THREE.Vector3; size:[number,number]}
/** Upright cold-water washer on two wheels, 0.40 × 0.455 × 0.70 m body (HD 6/15 M class) with a push handle to 0.93 m.
 * Front faces +Z. Spare quick-connect tips sit in the holder on top, in the same colours the game uses. */
export function buildWasher(k:Maker,tipColours:number[]):Washer {
  const g=new THREE.Group(),body=k.mat(0x2a2e33,.55,.1),hood=k.mat(0xd3a416,.42,.05),dark=k.mat(0x15171a,.7,0),steel=k.mat(0xb9bec2,.3,.9),tyre=k.mat(0x0e0e0f,.92,0),brass=k.mat(0xb8893c,.34,.92);
  g.add(k.box([.4,.3,.44],body,[0,.27,0],[0,0,0],.035),k.box([.36,.3,.34],hood,[0,.55,-.02],[0,0,0],.05),k.box([.3,.05,.3],dark,[0,.705,-.03],[0,0,0],.02));
  // Cooling slots on both sides.
  for(const s of [-1,1])for(let i=0;i<6;i++)g.add(k.box([.004,.012,.16],dark,[s*.2,.2+i*.026,0]));
  // Front panel: pressure gauge, regulator knob, rotary switch.
  g.add(k.box([.3,.2,.012],dark,[0,.5,.152],[0,0,0],.005));
  const dial=k.canvas(256,256,c=>{c.fillStyle='#f3f1ea';c.beginPath();c.arc(128,128,124,0,7);c.fill();c.strokeStyle='#17191b';c.lineWidth=5;
    for(let i=0;i<=20;i++){const a=Math.PI*.75+i/20*Math.PI*1.5,l=i%5?12:24;c.beginPath();c.moveTo(128+Math.cos(a)*112,128+Math.sin(a)*112);c.lineTo(128+Math.cos(a)*(112-l),128+Math.sin(a)*(112-l));c.stroke();}
    c.strokeStyle='#b3221b';c.lineWidth=10;c.beginPath();c.arc(128,128,106,Math.PI*1.95,Math.PI*2.25);c.stroke();
    c.fillStyle='#17191b';c.font='600 26px sans-serif';c.textAlign='center';['0','50','100','150','200'].forEach((t,i)=>{const a=Math.PI*.75+i/4*Math.PI*1.5;c.fillText(t,128+Math.cos(a)*70,137+Math.sin(a)*70);});c.font='600 22px sans-serif';c.fillText('bar',128,196);});
  g.add(k.rod([-.07,.54,.156],[-.07,.54,.176],.043,steel,28));
  const face=k.mesh(new THREE.CircleGeometry(.039,28),k.mat(0xffffff,.4,0,{map:dial}),[-.07,.54,.1765]);g.add(face);
  const needle=k.mesh(new THREE.BoxGeometry(.003,.034,.001),k.mat(0xb3221b,.5,0),[-.07,.54,.178]);needle.geometry.translate(0,.012,0);needle.rotation.z=Math.PI*.75;g.add(needle);
  g.add(k.rod([.07,.55,.156],[.07,.55,.186],.027,dark,20),k.rod([.07,.55,.186],[.07,.55,.19],.02,k.mat(0xb3221b,.5,0),20),k.box([.05,.05,.02],k.mat(0xb3221b,.5,0),[.07,.455,.166],[0,0,.5],.006),k.box([.012,.05,.012],dark,[.07,.455,.18],[0,0,.5],.003));
  // Outlet and water inlet low on the front.
  g.add(k.rod([-.09,.2,.2],[-.09,.2,.25],.011,brass,12),k.rod([-.09,.2,.235],[-.09,.2,.25],.014,steel,6),k.rod([.09,.17,.2],[.09,.17,.235],.013,brass,12));
  // Wheels, axle, front foot.
  for(const s of [-1,1]){
    g.add(k.mesh(new THREE.TorusGeometry(.092,.027,12,28),tyre,[s*.225,.118,-.17],[0,Math.PI/2,0]),k.rod([s*.205,.118,-.17],[s*.245,.118,-.17],.07,k.mat(0x3b3f44,.5,.2),20),k.rod([s*.245,.118,-.17],[s*.252,.118,-.17],.022,steel,14));
  }
  g.add(k.rod([-.2,.118,-.17],[.2,.118,-.17],.01,steel,8),k.box([.26,.1,.05],dark,[0,.06,.17],[0,0,0],.015));
  // Push handle: one bent tube up the back.
  g.add(k.tube([[-.17,.2,-.2],[-.17,.7,-.215],[-.165,.88,-.24],[-.12,.93,-.25],[.12,.93,-.25],[.165,.88,-.24],[.17,.7,-.215],[.17,.2,-.2]],.012,steel,60,10));
  g.add(k.rod([-.07,.93,-.25],[.07,.93,-.25],.016,dark,12));
  // Tip holder with the spare tips, lance hook, coiled mains lead on the handle.
  tipColours.forEach((colour,i)=>{const x=-(tipColours.length-1)*.022+i*.044;g.add(k.rod([x,.73,-.03],[x,.75,-.03],.011,steel,12),k.rod([x,.75,-.03],[x,.766,-.03],.0123,k.mat(colour,.4,.1),14),k.rod([x,.766,-.03],[x,.782,-.03],.007,brass,10));});
  g.add(k.mesh(new THREE.TorusGeometry(.085,.011,10,26),k.mat(0x18191b,.8,0),[0,.78,-.262],[.12,0,0]),k.mesh(new THREE.TorusGeometry(.078,.011,10,26),k.mat(0x18191b,.8,0),[0,.775,-.282],[.12,0,.4]));
  return {group:g,needle,outlet:new THREE.Vector3(-.09,.2,.25),size:[.5,.56]};
}

/* ------------------------------------------------------------------ wall fan ------------------------------------------------------------------ */

export interface Fan {group:THREE.Group; rotor:THREE.Group}
/** 450 mm industrial wall fan. Mounted with its plate at the local origin, blowing along +X. */
export function buildFan(k:Maker):Fan {
  const g=new THREE.Group(),black=k.mat(0x16181a,.55,.5),wire=k.mat(0x24272a,.4,.75),blade=k.mat(0x1d1f22,.45,.3);
  g.add(k.box([.012,.16,.12],black,[.006,0,0]),k.rod([.01,0,0],[.15,-.02,0],.016,black,10),k.box([.05,.07,.06],black,[.15,-.02,0],[0,0,0],.01));
  const head=new THREE.Group();head.position.set(.2,.02,0);head.rotation.z=-.28;g.add(head);
  head.add(k.mesh(new THREE.CapsuleGeometry(.055,.08,6,16),black,[.02,0,0],[0,0,Math.PI/2]));
  const R=.235,parts:THREE.Mesh[]=[];
  const ring=(radius:number,x:number)=>{const m=new THREE.Mesh(new THREE.TorusGeometry(radius,.0024,5,40));m.rotation.y=Math.PI/2;m.position.x=x;parts.push(m);};
  for(const x of [.1,.135,.17,.205])ring(R,x);for(const r of [.05,.11,.17])ring(r,.215+.012*(1-r/R));for(const r of [.07,.15])ring(r,.09-.004);
  for(let i=0;i<40;i++){const a=i/40*Math.PI*2,c=Math.cos(a),s=Math.sin(a);
    for(const [x0,x1,inner] of [[.227,.205,.045],[.086,.1,.06]] as [number,number,number][]){
      const from=new THREE.Vector3(x0,c*inner,s*inner),to=new THREE.Vector3(x1,c*R,s*R),m=new THREE.Mesh(new THREE.CylinderGeometry(.0016,.0016,from.distanceTo(to),4));
      m.position.copy(from).add(to).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),to.clone().sub(from).normalize());parts.push(m);}}
  head.add(k.merged(parts,wire));parts.forEach(p=>p.geometry.dispose());
  head.add(k.rod([.222,0,0],[.232,0,0],.048,black,20));
  const rotor=new THREE.Group();rotor.position.x=.155;head.add(rotor);rotor.add(k.rod([-.02,0,0],[.03,0,0],.04,black,16));
  const leaf=new THREE.Shape();leaf.moveTo(0,.03);leaf.bezierCurveTo(.09,.02,.13,.1,.1,.2);leaf.bezierCurveTo(.06,.215,-.02,.2,-.05,.16);leaf.bezierCurveTo(-.07,.1,-.04,.05,0,.03);
  for(let i=0;i<3;i++){const b=k.mesh(new THREE.ExtrudeGeometry(leaf,{depth:.002,bevelEnabled:false,curveSegments:10}),blade);b.rotation.set(i*Math.PI*2/3,Math.PI/2+.42,0,'XYZ');rotor.add(b);}
  return {group:g,rotor};
}

/* ------------------------------------------------------------------ small things ------------------------------------------------------------------ */

/** 700 mm traffic cone: orange PVC, two reflective sleeves, black recycled-rubber base. */
export function buildCone(k:Maker){
  const g=new THREE.Group(),orange=k.mat(0xd94a14,.55,0,{side:THREE.DoubleSide}),white=k.mat(0xe9e9e4,.3,0,{side:THREE.DoubleSide}),rubber=k.mat(0x151515,.9,0);
  const r=(y:number)=>.142-(y-.03)/.68*(.142-.03);
  const bands:[number,number,THREE.Material][]=[[.03,.3,orange],[.3,.42,white],[.42,.5,orange],[.5,.57,white],[.57,.71,orange]];
  for(const [a,b,m] of bands){g.add(k.lathe([[r(a),a],[r(b),b]],m,28));}
  g.add(k.lathe([[r(.71),.71],[r(.71)-.008,.71],[r(.71)-.01,.69]],orange,28),k.lathe([[.19,.03],[.142,.03],[.15,.045]],orange,28));
  g.add(k.box([.37,.03,.37],rubber,[0,.015,0],[0,0,0],.012));
  return g;
}
/** 15 L bucket, wire handle folded down, wash water and a sponge. */
export function buildBucket(k:Maker,colour=0x2f66a8){
  const g=new THREE.Group(),plastic=k.mat(colour,.42,0,{side:THREE.DoubleSide});
  g.add(k.lathe([[.0001,0],[.118,0],[.124,.008],[.152,.28],[.16,.283],[.16,.294],[.146,.294],[.146,.284],[.119,.014],[.0001,.014]],plastic,32));
  g.add(k.mesh(new THREE.CircleGeometry(.139,32),k.mat(0x8fa1a8,.06,0,{transparent:true,opacity:.82}),[0,.2,0],[-Math.PI/2,0,0],false));
  const handle=k.mesh(new THREE.TorusGeometry(.163,.003,6,36,Math.PI),k.mat(0xb9bec2,.3,.9),[0,.262,0],[Math.PI/2+.42,0,0]);g.add(handle);
  for(const s of [-1,1])g.add(k.box([.012,.03,.03],plastic,[s*.163,.268,0],[0,0,0],.004));
  g.add(k.box([.15,.055,.095],k.mat(0xd9b441,.95,0),[.26,.028,.06],[0,.5,0],.012));
  return g;
}
/** Two-step work platform, 0.6 m high, 600 × 340 mm top: aluminium treads with anti-slip ribs, splayed legs, rubber feet. */
export function buildStep(k:Maker,height:number,top:readonly [number,number]){
  const g=new THREE.Group(),alu=k.mat(0xb6babd,.36,.85),dark=k.mat(0x8d9296,.5,.8),rubber=k.mat(0x151515,.9,0);
  const tread=(w:number,d:number,y:number,z:number)=>{g.add(k.box([w,.028,d],alu,[0,y-.014,z],[0,0,0],.004));for(let i=0;i<Math.floor(d/.03);i++)g.add(k.box([w-.03,.003,.008],dark,[0,y+.0005,z-d/2+.022+i*.03]));};
  tread(top[0],top[1],height,0);tread(top[0]-.04,.2,height/2,.24);
  for(const s of [-1,1]){
    const legs:[V3,V3][]=[[[s*.275,height-.03,-.14],[s*.3,0,-.2]],[[s*.275,height-.03,.14],[s*.3,0,.38]]];
    for(const [a,b] of legs){g.add(k.rod(a,b,.014,alu,10),k.rod([b[0],.0,b[2]],[b[0],.025,b[2]],.02,rubber,12));}
    g.add(k.rod([s*.29,.14,-.17],[s*.29,.14,.33],.009,alu,8),k.rod([s*.285,height/2-.03,-.15],[s*.285,height/2-.03,.26],.009,alu,8));
  }
  g.add(k.rod([-.3,.02,-.2],[.3,.02,-.2],.009,alu,8),k.rod([-.3,.02,.38],[.3,.02,.38],.009,alu,8));
  return g;
}
/** Drain trench across the bay: a recessed channel, an angle-iron frame and a bar grate (20 × 5 mm bars at 30 mm). */
export function buildDrain(k:Maker,width:number,depthAcross:number){
  const g=new THREE.Group(),frame=k.mat(0x5d6164,.5,.85),bar=k.mat(0x777c80,.42,.9),pit=k.mat(0x070808,.9,0);
  const floor=k.mesh(new THREE.PlaneGeometry(width,depthAcross),pit,[0,-.09,0],[-Math.PI/2,0,0],false);g.add(floor);
  for(const s of [-1,1]){g.add(k.mesh(new THREE.PlaneGeometry(width,.09),k.mat(0x1c1d1e,.8,0),[0,-.045,s*depthAcross/2],[0,s>0?Math.PI:0,0],false),k.box([width,.006,.02],frame,[0,-.003,s*(depthAcross/2-.01)]));}
  const count=Math.floor(width/.03),bars=new THREE.InstancedMesh(k.keep(new THREE.BoxGeometry(.006,.02,depthAcross-.036)),bar,count),m=new THREE.Matrix4();
  for(let i=0;i<count;i++){m.makeTranslation(-width/2+.015+i*.03,-.012,0);bars.setMatrixAt(i,m);}bars.receiveShadow=true;g.add(bars);
  for(let x=-width/2+.5;x<width/2;x+=1)g.add(k.box([.02,.018,depthAcross-.036],frame,[x,-.013,0]));
  return g;
}
/** 1.2 m LED batten: aluminium body, opal diffuser. The diffuser is returned so the scene can make it glow. */
export function buildBatten(k:Maker,length:number,glow:THREE.Material){
  const g=new THREE.Group(),body=k.mat(0xc9ccce,.45,.7);
  g.add(k.box([length,.028,.07],body,[0,-.014,0],[0,0,0],.004));
  const diffuser=k.mesh(new THREE.CylinderGeometry(.032,.032,length-.03,14,1,false,Math.PI/2,Math.PI),glow,[0,-.026,0],[0,0,Math.PI/2],false);diffuser.scale.set(.75,1,1);g.add(diffuser);
  for(const s of [-1,1])g.add(k.box([.012,.05,.074],body,[s*(length/2-.006),-.03,0],[0,0,0],.003));
  return g;
}

/* ------------------------------------------------------------------ high-pressure hose ------------------------------------------------------------------ */

/** The hose from the washer to the gun: along the left wall, round whichever end of the car is nearer, across the
 * floor to the player's feet and up to the swivel under the grip. Rebuilt when either end moves. */
export class Hose {
  readonly mesh:THREE.Mesh;
  private readonly last=new THREE.Vector3(1e9,0,0);
  private readonly lastFoot=new THREE.Vector3(1e9,0,0);
  constructor(material:THREE.Material,private readonly outlet:THREE.Vector3,private readonly wallX:number,private readonly radius=.0072){
    this.mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);this.mesh.castShadow=true;this.mesh.receiveShadow=true;this.mesh.frustumCulled=false;
  }
  update(inlet:THREE.Vector3,foot:THREE.Vector3,car:THREE.Box2){
    if(inlet.distanceToSquared(this.last)<1e-6&&foot.distanceToSquared(this.lastFoot)<1e-4)return;
    this.last.copy(inlet);this.lastFoot.copy(foot);
    const y=this.radius+.002,o=this.outlet,p:THREE.Vector3[]=[o.clone(),new THREE.Vector3(o.x,y+.02,o.z+.16),new THREE.Vector3(this.wallX,y,o.z+.5)];
    const alongZ=THREE.MathUtils.clamp(foot.z,o.z+.9,car.max.y+.5);
    if(foot.x>car.min.x-.15){
      // Player is in front of, behind or beyond the car: go round the nearer end.
      const front=foot.z>(car.min.y+car.max.y)/2,endZ=front?Math.max(car.max.y+.22,Math.min(foot.z,car.max.y+.6)):Math.min(car.min.y-.22,Math.max(foot.z,car.min.y-.5));
      if(front)p.push(new THREE.Vector3(this.wallX,y,endZ-.9));
      p.push(new THREE.Vector3(car.min.x-.35,y,endZ));
      if(foot.x>car.max.x)p.push(new THREE.Vector3(car.max.x+.3,y,endZ));
    }else p.push(new THREE.Vector3(this.wallX+.02,y,alongZ-.7));
    const lastFloor=p[p.length-1],toFoot=foot.clone().sub(lastFloor);toFoot.y=0;const gap=toFoot.length();
    if(gap>.5)p.push(lastFloor.clone().addScaledVector(toFoot,.5).setY(y));
    // Slack on the floor by the feet, then up to the inlet with a hanging belly.
    p.push(new THREE.Vector3(foot.x,y,foot.z),new THREE.Vector3(THREE.MathUtils.lerp(foot.x,inlet.x,.55),Math.max(y+.05,inlet.y*.32),THREE.MathUtils.lerp(foot.z,inlet.z,.55)),
      new THREE.Vector3(inlet.x,inlet.y-.16,inlet.z),inlet.clone());
    const curve=new THREE.CatmullRomCurve3(p,false,'centripetal'),next=new THREE.TubeGeometry(curve,Math.min(220,Math.ceil(curve.getLength()*22)),this.radius,6);
    this.mesh.geometry.dispose();this.mesh.geometry=next;
  }
  dispose(){this.mesh.geometry.dispose();}
}
