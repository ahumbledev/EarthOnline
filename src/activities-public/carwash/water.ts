/** What the water looks like: a dense white fan or jet leaving the tip at speed, breaking into streaks,
 * a cloud of mist where it lands, and spray thrown back along the surface. Only looks: what gets cleaned is
 * decided in gpu.ts from the same nozzle angles. */
import * as THREE from 'three';

const ACROSS=21,ALONG=14,DROPS=2200,MIST=520;

const SHEET_FRAGMENT=`uniform float uTime,uLength,uSolid;varying vec2 vUv;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
void main(){
  float across=abs(vUv.x-.5)*2.,along=vUv.y,metres=along*uLength;
  // Fast streaks running away from the tip; finer near it, torn apart further out.
  float lines=n(vec2(vUv.x*90.,metres*5.-uTime*46.))*.6+n(vec2(vUv.x*31.,metres*2.2-uTime*31.))*.4;
  float tear=n(vec2(vUv.x*14.,metres*3.-uTime*19.));
  float edge=1.-smoothstep(mix(.8,.55,along),1.,across);
  // Solid white at the tip; further out the streaks show, but the stream holds together until it lands.
  float body=mix(1.,.45+.55*smoothstep(.2,.7,lines),smoothstep(.03,.45,along))*mix(1.,.6+.4*smoothstep(.2,.6,tear),smoothstep(.4,1.,along));
  float a=edge*body*mix(1.,.82,along)*uSolid*smoothstep(0.,.012,along);
  // A cooler rim keeps the stream readable in front of white paint.
  vec3 colour=mix(vec3(.62,.74,.86),vec3(1.),smoothstep(.15,.75,body*edge))*1.45;
  gl_FragColor=vec4(colour,a);}`;
/** Water breaking where it lands and racing outward along the surface. */
const BURST_FRAGMENT=`uniform float uTime,uPower;varying vec2 vUv;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
void main(){
  vec2 p=vUv*2.-1.;float r=length(p),t=atan(p.y,p.x);if(r>1.)discard;
  float rays=n(vec2(t*9.,r*5.-uTime*17.))*.55+n(vec2(t*23.,r*9.-uTime*27.))*.45;
  float fine=n(vec2(t*61.,r*14.-uTime*33.));
  float spokes=smoothstep(.3,.8,rays*.75+fine*.25)*(1.-smoothstep(.1,1.,r));
  float core=1.-smoothstep(0.,.3,r);
  float a=clamp(core*.95+spokes*.8,0.,1.)*uPower;
  vec3 colour=mix(vec3(.66,.77,.88),vec3(1.),clamp(core+spokes*.5,0.,1.))*1.45;
  gl_FragColor=vec4(colour,a);}`;
const POINT_VERTEX=`attribute float aSize;attribute float aAlpha;uniform float uScale;varying float vAlpha;
void main(){vAlpha=aAlpha;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=min(900.,aSize*uScale/max(.08,-mv.z));}`;
const POINT_FRAGMENT=`uniform float uHard;uniform vec3 uColour;varying float vAlpha;
void main(){float r=length(gl_PointCoord-.5)*2.;float a=(1.-smoothstep(uHard,1.,r))*vAlpha;if(a<.004)discard;gl_FragColor=vec4(uColour,a);}`;

interface Pool {points:THREE.Points; position:Float32Array; velocity:Float32Array; life:Float32Array; span:Float32Array; size:Float32Array; grow:Float32Array; alpha:Float32Array; peak:Float32Array; next:number}

export interface SprayShape {
  /** Full spread across and through the fan, degrees. */
  horizontal:number; vertical:number;
  /** Half-angle of the cone a rotary nozzle's jet runs round, degrees (0 = not rotary). */
  cone:number;
  /** Foam instead of clear water (the soap nozzle). */
  foam:boolean;
  /** 0..1 how hard the machine is (heavier machines throw more mist). */
  force:number;
}

export class SprayFX {
  readonly group=new THREE.Group();
  private readonly sheets:THREE.Mesh[]=[];
  private readonly sheetMaterial:THREE.ShaderMaterial;
  private readonly burst:THREE.Mesh;
  private readonly burstMaterial:THREE.ShaderMaterial;
  private readonly drops:Pool;
  private readonly mist:Pool;
  private time=0;
  private readonly resources:{dispose():void}[]=[];

  constructor(){
    this.sheetMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{uTime:{value:0},uLength:{value:1},uSolid:{value:1}},
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:SHEET_FRAGMENT});
    this.resources.push(this.sheetMaterial);
    // Two sheets at right angles: the fan itself and its thickness, so it never vanishes edge-on.
    for(let s=0;s<2;s++){
      const g=new THREE.BufferGeometry(),uv=new Float32Array(ACROSS*ALONG*2),index:number[]=[];
      for(let j=0;j<ALONG;j++)for(let i=0;i<ACROSS;i++){uv[(j*ACROSS+i)*2]=i/(ACROSS-1);uv[(j*ACROSS+i)*2+1]=j/(ALONG-1);}
      for(let j=0;j<ALONG-1;j++)for(let i=0;i<ACROSS-1;i++){const a=j*ACROSS+i;index.push(a,a+1,a+ACROSS,a+1,a+ACROSS+1,a+ACROSS);}
      g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(ACROSS*ALONG*3),3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.setIndex(index);
      const mesh=new THREE.Mesh(g,this.sheetMaterial);mesh.frustumCulled=false;mesh.visible=false;mesh.renderOrder=3;this.sheets.push(mesh);this.group.add(mesh);this.resources.push(g);
    }
    this.burstMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{uTime:{value:0},uPower:{value:1}},
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:BURST_FRAGMENT});
    const disc=new THREE.PlaneGeometry(1,1);this.burst=new THREE.Mesh(disc,this.burstMaterial);this.burst.frustumCulled=false;this.burst.visible=false;this.burst.renderOrder=4;this.group.add(this.burst);this.resources.push(disc,this.burstMaterial);
    this.drops=this.pool(DROPS,.25,new THREE.Color(.93,.97,1),5);this.mist=this.pool(MIST,0,new THREE.Color(.86,.9,.94),6);
  }
  private pool(count:number,hard:number,colour:THREE.Color,order:number):Pool {
    const g=new THREE.BufferGeometry(),position=new Float32Array(count*3).fill(-50),size=new Float32Array(count),alpha=new Float32Array(count);
    g.setAttribute('position',new THREE.BufferAttribute(position,3));g.setAttribute('aSize',new THREE.BufferAttribute(size,1));g.setAttribute('aAlpha',new THREE.BufferAttribute(alpha,1));
    const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{uScale:{value:800},uHard:{value:hard},uColour:{value:colour}},vertexShader:POINT_VERTEX,fragmentShader:POINT_FRAGMENT});
    const points=new THREE.Points(g,material);points.frustumCulled=false;points.renderOrder=order;this.group.add(points);this.resources.push(g,material);
    return {points,position,velocity:new Float32Array(count*3),life:new Float32Array(count),span:new Float32Array(count),size,grow:new Float32Array(count),alpha,peak:new Float32Array(count),next:0};
  }
  private emit(p:Pool,at:THREE.Vector3,velocity:THREE.Vector3,life:number,size:number,grow:number,alpha:number){
    const i=p.next;p.next=(p.next+1)%p.life.length;const k=i*3;
    p.position[k]=at.x;p.position[k+1]=at.y;p.position[k+2]=at.z;p.velocity[k]=velocity.x;p.velocity[k+1]=velocity.y;p.velocity[k+2]=velocity.z;
    p.life[i]=p.span[i]=life;p.size[i]=size;p.grow[i]=grow;p.peak[i]=alpha;
  }
  private step(p:Pool,dt:number,gravity:number,drag:number){
    for(let i=0;i<p.life.length;i++){
      if(p.life[i]<=0)continue;const k=i*3;p.life[i]-=dt;
      if(p.life[i]<=0||p.position[k+1]<0){p.life[i]=0;p.alpha[i]=0;p.position[k+1]=-50;continue;}
      p.velocity[k+1]-=gravity*dt;const keep=Math.exp(-drag*dt);
      for(let c=0;c<3;c++){p.velocity[k+c]*=keep;p.position[k+c]+=p.velocity[k+c]*dt;}
      p.size[i]=Math.max(.001,p.size[i]+p.grow[i]*dt);const age=1-p.life[i]/p.span[i];p.alpha[i]=p.peak[i]*Math.min(1,age*8)*(1-age)*(1-age*.4);
    }
    for(const name of ['position','aSize','aAlpha'])(p.points.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate=true;
  }
  /** Point sprites are sized in metres: tell them how many pixels a metre is at one metre away. */
  setViewport(heightPixels:number,fovDegrees:number){const scale=heightPixels/(2*Math.tan(fovDegrees*Math.PI/360));for(const p of [this.drops,this.mist])(p.points.material as THREE.ShaderMaterial).uniforms.uScale.value=scale;}

  /** Draws the water from `tip` to where it lands (`target` null = trigger released); particles keep flying either way. */
  update(tip:THREE.Vector3,target:THREE.Vector3|null,shape:SprayShape,rotated:boolean,dt:number){
    this.time+=dt;this.sheetMaterial.uniforms.uTime.value=this.burstMaterial.uniforms.uTime.value=this.time;
    for(const s of this.sheets)s.visible=!!target&&!shape.foam;this.burst.visible=!!target&&!shape.foam;
    if(target){
      const dir=target.clone().sub(tip),length=Math.max(.05,dir.length());dir.divideScalar(length);
      let right=new THREE.Vector3().crossVectors(dir,new THREE.Vector3(0,1,0));if(right.lengthSq()<1e-6)right.set(1,0,0);right.normalize();
      const up=new THREE.Vector3().crossVectors(right,dir),wide=rotated?up:right,thin=rotated?right:up;
      const land=target.clone();
      if(shape.cone>0){ // rotary: the jet runs round a cone many times a second
        const r=length*Math.tan(shape.cone*Math.PI/180),a=this.time*72;land.addScaledVector(right,Math.cos(a)*r).addScaledVector(up,Math.sin(a)*r);dir.copy(land).sub(tip).normalize();
      }
      // Drawn a little fuller than the cleaning footprint: a real stream carries a sheath of spray round it.
      const halfWide=Math.tan(Math.max(shape.horizontal*1.15,5)*Math.PI/360),halfThin=Math.tan(Math.max(shape.vertical,4.5)*Math.PI/360);
      this.sheetMaterial.uniforms.uLength.value=length;this.sheetMaterial.uniforms.uSolid.value=shape.foam?.8:1;
      [[wide,halfWide],[thin,halfThin]].forEach(([axis,half],s)=>{
        const p=this.sheets[s].geometry.getAttribute('position') as THREE.BufferAttribute,a=axis as THREE.Vector3,spread=half as number;
        for(let j=0;j<ALONG;j++){const along=j/(ALONG-1)*length,w=.007+along*spread;
          for(let i=0;i<ACROSS;i++){const u=i/(ACROSS-1)*2-1;p.setXYZ(j*ACROSS+i,tip.x+dir.x*along+a.x*u*w,tip.y+dir.y*along+a.y*u*w,tip.z+dir.z*along+a.z*u*w);}}
        p.needsUpdate=true;
      });
      if(shape.foam){
        // Foam leaves the lance as a cone of white clumps that swell as they fly and pile up where they land.
        const frames=Math.min(1.5,dt*60),at=new THREE.Vector3(),v=new THREE.Vector3(),speed=7,spread=Math.tan(shape.horizontal*Math.PI/360);
        for(let n=Math.round(26*frames);n>0;n--){
          const a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*spread;
          v.copy(dir).addScaledVector(right,Math.cos(a)*r).addScaledVector(up,Math.sin(a)*r).normalize().multiplyScalar(speed*(.8+Math.random()*.4));
          at.copy(tip).addScaledVector(v,Math.random()*dt);
          this.emit(this.mist,at,v,Math.min(1.2,length/speed)*(.85+Math.random()*.3),.045+Math.random()*.04,.7+Math.random()*.5,.6);
        }
        for(let n=Math.round(5*frames);n>0;n--){
          const a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*spread*length;
          at.copy(land).addScaledVector(right,Math.cos(a)*r).addScaledVector(up,Math.sin(a)*r).addScaledVector(dir,-.02);
          v.set((Math.random()-.5)*.5,.1+Math.random()*.3,(Math.random()-.5)*.5).addScaledVector(dir,-.3-Math.random()*.5);
          this.emit(this.mist,at,v,.4+Math.random()*.5,.09+Math.random()*.09,.2,.3);
        }
        for(let n=Math.round(6*frames);n>0;n--){
          const a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*spread*length;
          at.copy(land).addScaledVector(right,Math.cos(a)*r).addScaledVector(up,Math.sin(a)*r);
          v.set(Math.random()-.5,Math.random()*.6,Math.random()-.5).multiplyScalar(1.6).addScaledVector(dir,-.6);
          this.emit(this.drops,at,v,.3+Math.random()*.4,.012+Math.random()*.014,0,.9);
        }
        this.step(this.drops,dt,9.8,.6);this.step(this.mist,dt,.35,shape.foam?.4:4);return;
      }
      // Where it lands: a white line of water breaking on the surface, fine spray thrown out along it and back at
      // the player, water running down from it, and mist rolling off.
      const footprint=Math.max(.04,length*halfWide),depth=Math.max(.015,length*halfThin),force=.75+shape.force*.5,frames=Math.min(1.5,dt*60),v=new THREE.Vector3(),at=new THREE.Vector3();
      const count=(perFrame:number)=>{const n=perFrame*force*frames;return Math.floor(n)+(Math.random()<n%1?1:0);};
      const onLine=()=>at.copy(land).addScaledVector(wide,(Math.random()*2-1)*footprint).addScaledVector(thin,(Math.random()*2-1)*depth);
      // The burst lies across the stream, a few centimetres off the surface, stretched along the fan.
      this.burst.position.copy(land).addScaledVector(dir,-.035);this.burst.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(wide,thin,dir.clone().negate()));
      this.burst.scale.set(2*(footprint+.2*force),2*(depth+.17*force),1);this.burstMaterial.uniforms.uPower.value=shape.foam?.7:1;
      for(let n=count(shape.foam?24:90);n>0;n--){
        onLine();v.set(Math.random()-.5,Math.random()-.5,Math.random()-.5).normalize();v.addScaledVector(dir,-v.dot(dir)).normalize().multiplyScalar((2.5+Math.random()*6.5)*force);
        v.addScaledVector(dir,-(.3+Math.random()*2.6)*force);
        this.emit(this.drops,at,v,.08+Math.random()*.17,shape.foam?.024:.005+Math.random()*.009,-.012,.8);
      }
      for(let n=count(shape.foam?5:16);n>0;n--){onLine();v.set((Math.random()-.5)*.4,-.2-Math.random()*.6,(Math.random()-.5)*.4);this.emit(this.drops,at,v,.35+Math.random()*.4,.008+Math.random()*.008,0,.7);}
      for(let n=count(shape.foam?2:5);n>0;n--){
        onLine().addScaledVector(dir,-.05);v.set(Math.random()-.5,Math.random()-.5,Math.random()-.5).normalize();v.addScaledVector(dir,-v.dot(dir)).multiplyScalar((.8+Math.random()*1.6)*force).addScaledVector(dir,-(.5+Math.random()*1.2)*force);v.y+=.2;
        this.emit(this.mist,at,v,.35+Math.random()*.4,.1+footprint*.3+Math.random()*.1,.45+Math.random()*.4,(shape.foam?.06:.1)*force);
      }
      // Fine mist peeling off the stream itself.
      if(!shape.foam)for(let n=count(5);n>0;n--){const along=.15+Math.random()*.8;at.copy(tip).addScaledVector(dir,along*length).addScaledVector(wide,(Math.random()*2-1)*along*length*halfWide);
        v.copy(dir).multiplyScalar(2.5).add(new THREE.Vector3(Math.random()-.5,Math.random()*.3,Math.random()-.5).multiplyScalar(.4));this.emit(this.mist,at,v,.2+Math.random()*.25,.04+Math.random()*.06,.3,.09);}
    }
    this.step(this.drops,dt,9.8,.6);this.step(this.mist,dt,.35,4);
  }
  dispose(){this.resources.forEach(r=>r.dispose());}
}
