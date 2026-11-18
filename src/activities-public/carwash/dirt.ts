/** Generates seeded dust, mud and grease from surface orientation, height, wheel position and exposure. */
import type { DirtRecipe, PartKind } from './rules.ts';

export interface DirtInput {
  size:number; position:Float32Array; normal:Float32Array;
  /** Part index per texel (255 = not a target); kinds[i] is the kind of part i. */
  partOf:Uint8Array; kinds:readonly PartKind[];
  /** Open-sky share 0..255 on a coarser square grid. */
  access:Uint8Array; accessSize:number;
  dimensions:readonly [number,number,number];
  wheels:readonly {x:number; y:number; z:number; radius:number}[];
}
export const DRY = -1e4;

function hash(x:number,y:number,z:number,seed:number){
  let h=Math.imul(x,0x27d4eb2d)^Math.imul(y,0x165667b1)^Math.imul(z,0x9e3779b1)^Math.imul(seed,0x85ebca6b);
  h=Math.imul(h^(h>>>15),0x2c1b3c6d);h=Math.imul(h^(h>>>12),0x297a2d39);return ((h^(h>>>15))>>>0)/4294967296;
}
function noise(x:number,y:number,z:number,seed:number){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=x-ix,fy=y-iy,fz=z-iz;
  const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy),w=fz*fz*(3-2*fz);
  const a=hash(ix,iy,iz,seed),b=hash(ix+1,iy,iz,seed),c=hash(ix,iy+1,iz,seed),d=hash(ix+1,iy+1,iz,seed);
  const e=hash(ix,iy,iz+1,seed),f=hash(ix+1,iy,iz+1,seed),g=hash(ix,iy+1,iz+1,seed),h=hash(ix+1,iy+1,iz+1,seed);
  const ab=a+(b-a)*u,cd=c+(d-c)*u,ef=e+(f-e)*u,gh=g+(h-g)*u;
  const lo=ab+(cd-ab)*v,hi=ef+(gh-ef)*v;return lo+(hi-lo)*w;
}
function fbm(x:number,y:number,z:number,seed:number,octaves=3){
  let sum=0,amp=.5,norm=0;for(let o=0;o<octaves;o++){sum+=noise(x,y,z,seed+o*101)*amp;norm+=amp;x*=2.03;y*=2.03;z*=2.03;amp*=.5;}return sum/norm;
}
const clamp=(v:number)=>v<0?0:v>1?1:v;
const smooth=(a:number,b:number,v:number)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};

export function generateDirt(input:DirtInput,recipe:DirtRecipe,seed:number,out=new Float32Array(input.size*input.size*4)){
  const {size,position:P,normal:N,partOf,kinds,access,accessSize,dimensions,wheels}=input;
  const [,height,length]=dimensions,front=length/2,rear=-length/2;
  const frontAxle=Math.max(...wheels.map(w=>w.z));
  const exhaustX=(seed&1?1:-1)*.42,scale=accessSize/size;
  for(let i=0;i<size*size;i++){
    const k=i*4;out[k+3]=DRY;
    if(!N[k+3]){out[k]=out[k+1]=out[k+2]=0;continue;}
    const x=P[k],y=P[k+1],z=P[k+2],nx=N[k],ny=N[k+1],nz=N[k+2];
    const ax=Math.min(accessSize-1,Math.floor((i%size)*scale)),ay=Math.min(accessSize-1,Math.floor(Math.floor(i/size)*scale));
    const open=access[ay*accessSize+ax]/255,crevice=1-open;
    const part=partOf[i],kind=part<kinds.length?kinds[part]:undefined;
    const up=Math.max(0,ny),side=Math.abs(nx);
    const blotch=fbm(x*2.2,y*2.2,z*2.2,seed),fine=fbm(x*9,y*9,z*9,seed+7,2);
    const glass=kind==='window'||kind==='windscreen';

    // Dust: a film everywhere, thickest on upward faces, rain streaks running down below glass and trims.
    let dust=(.55+.45*up**1.3)*(.82+.36*blotch)*(.96+.08*fine);
    if(ny<-.35)dust*=.45;
    if(up<.5&&y<height*.8){const streak=noise((Math.abs(nx)>Math.abs(nz)?z:x)*42,y*1.6,0,seed+31);dust*=.93+.18*smooth(.55,.8,streak);}
    if(glass)dust*=up>.3?.75+.3*smooth(.62,.72,fbm(x*18,y*18,z*18,seed+41,2)):.62;
    dust+=crevice*.35+recipe.lowDust*smooth(.75,.08,y)*(.6+.4*blotch);
    if(kind==='hubcap')dust+=recipe.lowDust*.6;
    dust=clamp(dust*recipe.dust);

    // Mud: road spray from below and behind each wheel.
    let mud=0;
    if(recipe.mud>0){
      let spray=0;
      for(const w of wheels){
        const behind=w.z-z,reach=behind>-.12&&behind<1.4?Math.exp(-Math.max(0,behind)/.55):0;
        spray=Math.max(spray,reach*smooth(w.y+w.radius*1.55,w.y-w.radius*.3,y)*(side>.25||ny<0?1:.4));
        if(Math.hypot(y-w.y,z-w.z)<w.radius+.17&&Math.abs(x)<Math.abs(w.x)+.3&&kind===undefined)spray=1;
      }
      let base=Math.max(smooth(.95,.12,y),spray);
      if(nz<-.5)base=Math.max(base,.8*smooth(.95,.18,y));
      if(nz>.5&&z>front-.5)base=Math.max(base,.5*smooth(.55,.1,y));
      if(kind==='tyre')base=Math.max(base,.9);if(kind==='hubcap')base=Math.max(base,.45);
      base*=1-.8*up*smooth(.3,.6,y);
      const drops=smooth(.42,.62,fbm(x*14,y*14,z*14,seed+53));
      mud=clamp(recipe.mud*base*(.55+.45*drops)*(.7+.6*blotch)*1.25);
    }

    // Grease: brake dust, bugs, tar, soot, crevice grime.
    let grease=0;
    if(recipe.grease>0){
      if(kind==='hubcap')grease=(z>0?1:.55)*(.6+.4*fine)+crevice*.4;
      if(nz>.45&&z>front-.6&&y>.25&&y<height*.8)grease=Math.max(grease,.25+.85*smooth(.6,.78,fbm(x*25,y*25,z*25,seed+67)));
      if(side>.5&&y<.45&&z<frontAxle&&z>frontAxle-1.4)grease=Math.max(grease,.9*smooth(.68,.84,fbm(x*18,y*18,z*18,seed+71)));
      if(nz<-.5&&y<.55&&Math.abs(x-exhaustX)<.28)grease=Math.max(grease,.85*smooth(.28,0,Math.abs(x-exhaustX))*(.7+.3*blotch));
      grease=Math.max(grease,crevice*crevice*.75*smooth(1.1,.2,y));
      if(z<rear+.2&&y<.4)grease=Math.max(grease,.3*blotch);
      grease=clamp(grease*recipe.grease);
    }
    out[k]=dust;out[k+1]=mud;out[k+2]=grease;
  }
  return out;
}
