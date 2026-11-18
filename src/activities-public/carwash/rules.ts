export type NozzleId = 'fan' | 'jet' | 'turbo' | 'narrow' | 'wide' | 'soap';
export type WasherId = 'basic' | 'medium' | 'pressure' | 'pro';
export type LanceId = 'stubby' | 'short' | 'extension' | 'xlong';
export interface CurveKey {readonly time:number; readonly value:number; readonly inSlope:number; readonly outSlope:number}
export const WASHER_ORDER: readonly WasherId[] = ['basic','medium','pressure','pro'];
/** Shorter handles favour a broad sweep; longer handles reach the roof. */
export const LANCE = {
  stubby:{horizontalAngle:1.1,verticalAngle:1,range:.9,power:.85},
  short:{horizontalAngle:1,verticalAngle:1,range:1.05,power:1},
  extension:{horizontalAngle:.9,verticalAngle:1,range:1.3,power:1.1},
  xlong:{horizontalAngle:.8,verticalAngle:1,range:1.65,power:1.2},
} as const;
export const LANCE_ORDER: readonly LanceId[] = ['stubby','short','extension','xlong'];
/** Order on the tool bar and number keys (1–6). Colours are the real quick-connect code: red 0°, yellow 15°,
 * green 25°, white 40°. */
export const NOZZLE_ORDER: readonly NozzleId[] = ['fan','jet','turbo','narrow','wide','soap'];
export const NOZZLES: Record<NozzleId,{name:string; caption:string; tip:string; colour:number}> = {
  fan:{name:'扇形', caption:'大面积浮尘', tip:'绿色 25° 快插喷嘴', colour:0x2e9a4a},
  jet:{name:'直射', caption:'缝隙与泥垢', tip:'红色 0° 快插喷嘴', colour:0xc8261e},
  turbo:{name:'旋转', caption:'顽固油污', tip:'旋转喷嘴', colour:0x1a1a1a},
  narrow:{name:'窄扇', caption:'较脏的面', tip:'黄色 15° 快插喷嘴', colour:0xd9b21a},
  wide:{name:'宽扇', caption:'轻扫与冲净', tip:'白色 40° 快插喷嘴', colour:0xe9e9e4},
  soap:{name:'泡沫', caption:'配清洁液', tip:'黑色 65° 泡沫喷嘴', colour:0x2b2f33},
};
export interface DirtRecipe {dust:number; mud:number; grease:number; lowDust:number}
export const PRACTICE_RECIPE:DirtRecipe = {dust:.9,mud:.85,grease:.9,lowDust:.7};
export function evaluateCurve(keys:readonly CurveKey[], t:number) {
  if(!keys.length)return 0;
  if(t<=keys[0].time)return keys[0].value;
  const last=keys[keys.length-1];if(t>=last.time)return last.value;
  for(let i=0;i<keys.length-1;i++){
    const a=keys[i],b=keys[i+1];if(t>b.time)continue;
    const dt=b.time-a.time;if(dt<=0)return b.value;
    const s=(t-a.time)/dt,s2=s*s,s3=s2*s;
    return (2*s3-3*s2+1)*a.value+(s3-2*s2+s)*a.outSlope*dt+(-2*s3+3*s2)*b.value+(s3-s2)*b.inSlope*dt;
  }
  return last.value;
}
/** Uniform coverage inside the spray footprint. */
export function angleDensity(_fraction:number) { return 1; }
export interface Combined {horizontal:number; vertical:number; range:number; power:number; tiers:[number,number,number]; fade:readonly CurveKey[]; turboAngle:number; turboSpeed:number; turbo:boolean; soap:boolean}
const WASHERS = {
  basic:{power:1,range:3.4,mud:.08,grease:0}, medium:{power:1.65,range:4.2,mud:.6,grease:.04},
  pressure:{power:2.6,range:5.2,mud:1.8,grease:.8}, pro:{power:3.8,range:6.4,mud:3,grease:1.7},
} as const;
const SPRAYS:Record<NozzleId,{horizontal:number;vertical:number;power:number}> = {
  fan:{horizontal:22,vertical:2.2,power:1}, jet:{horizontal:1.6,vertical:1.6,power:.45},
  turbo:{horizontal:3.5,vertical:3.5,power:.75}, narrow:{horizontal:12,vertical:1.8,power:.8},
  wide:{horizontal:36,vertical:3,power:1.15}, soap:{horizontal:42,vertical:7,power:1.2},
};
const FALL_OFF:readonly CurveKey[] = [{time:0,value:1,inSlope:0,outSlope:0},{time:.65,value:1,inSlope:0,outSlope:0},{time:1,value:0,inSlope:0,outSlope:0}];
export function combinedNozzle(nozzle:NozzleId, washer:WasherId|boolean, lance:LanceId|boolean):Combined {
  const machine=WASHERS[typeof washer==='boolean'?(washer?'pressure':'basic'):washer];
  const attachment=LANCE[typeof lance==='boolean'?(lance?'extension':'stubby'):lance],spray=SPRAYS[nozzle];
  const grease=nozzle==='turbo'?2:nozzle==='jet'?1.5:1;
  return {horizontal:spray.horizontal*attachment.horizontalAngle,vertical:spray.vertical*attachment.verticalAngle,
    range:machine.range*attachment.range,power:machine.power*spray.power*attachment.power,
    tiers:[5,nozzle==='soap'?2:machine.mud,nozzle==='soap'?1.2:machine.grease*grease],
    fade:FALL_OFF,turboAngle:2.5,turboSpeed:8,turbo:nozzle==='turbo',soap:nozzle==='soap'};
}
export function distanceFade(c:Combined,distance:number){return distance<0||distance>c.range?0:Math.max(0,evaluateCurve(c.fade,distance/c.range));}

/** Calibrated locally for a walking sweep across a car panel; subject to playtesting. */
export const CLEAN_RATE = 0.04;
export const BRUSH = 0.03;
const DEG=Math.PI/180;
export function halfAngles(c:Combined,distance:number){
  const brush=Math.atan(BRUSH/2/Math.max(distance,.05));
  return {h:c.horizontal*DEG/2+brush, v:c.vertical*DEG/2+brush};
}
/** Removal per second of one dirt layer at a surface point, given the point's angles from the spray axis.
 * Rays spread over the footprint, so intensity falls with footprint area; grazing hits spread further (cos). */
export function texelRate(c:Combined,layer:0|1|2,distance:number,angleH:number,angleV:number,cosIncidence:number){
  if(cosIncidence<=0)return 0;const fade=distanceFade(c,distance);if(!fade)return 0;
  const half=halfAngles(c,distance),fx=Math.abs(angleH)/half.h,fy=Math.abs(angleV)/half.v;if(fx>1||fy>1)return 0;
  const area=(2*distance*Math.tan(half.h))*(2*distance*Math.tan(half.v));
  return CLEAN_RATE*c.tiers[layer]*c.power*fade*angleDensity(fx)*angleDensity(fy)*cosIncidence/area;
}

export type PartKind = 'bonnet'|'grille'|'body'|'door'|'hubcap'|'bumper-front'|'bumper-rear'|'windscreen'|'window'|'tyre'|'light'|'mirror';
/** Small details tolerate a little more residue than large flat panels. */
export const PART_THRESHOLDS: Record<PartKind,{threshold:number}> = {
  bonnet:{threshold:.04},grille:{threshold:.12},
  body:{threshold:.04},door:{threshold:.04},
  hubcap:{threshold:.1},'bumper-front':{threshold:.08},
  'bumper-rear':{threshold:.08},windscreen:{threshold:.06},
  window:{threshold:.06},tyre:{threshold:.1},
  light:{threshold:.12},mirror:{threshold:.12},
};
export const PIXEL_DIRTY = .25;
export interface PartSpec {id:string; name:string; kind:PartKind}
export function partProgress(start:number,current:number,threshold:number){
  const d=start>0?current/start:0;
  return threshold===1?(d<=0?1:0):Math.min(1,Math.max(0,(1-d)/(1-threshold)));
}
export function cleanWeight(start:number,threshold:number){return start*(1-threshold);}
export function totalProgress(rows:readonly {progress:number; weight:number}[]){
  let sum=0,weights=0;for(const r of rows)if(r.weight>0){sum+=r.progress*r.weight;weights+=r.weight;}
  return weights?sum/weights:1;
}
/** A texel is dirty when any layer is above the original PixelDirtyThreshold. partOf=255 means not a target. */
export function countDirty(state:ArrayLike<number>,partOf:Uint8Array,parts:number,out=new Uint32Array(parts)){
  out.fill(0);
  for(let i=0;i<partOf.length;i++){const p=partOf[i];if(p>=parts)continue;
    const k=i*4;if(state[k]>PIXEL_DIRTY||state[k+1]>PIXEL_DIRTY||state[k+2]>PIXEL_DIRTY)out[p]++;}
  return out;
}
