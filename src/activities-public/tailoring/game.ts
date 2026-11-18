/** Local, deterministic pattern cutting and sewing. */
import { t } from '../language.ts';
export type GarmentKind = 'tshirt' | 'jeans' | 'dress';
export type FabricId = 'denim' | 'jersey' | 'linen' | 'satin';
export type FitId = 'regular' | 'relaxed' | 'fitted';
export type TailoringStage = 'design' | 'cut' | 'sew' | 'finish' | 'wardrobe';
export interface Point { x: number; y: number }
export interface TailoringDesign {
  kind: GarmentKind; fabric: FabricId; color: string; threadColor: string; fit: FitId;
}
export interface GarmentDescriptor extends TailoringDesign { quality: number }
export interface FabricDefinition {
  id: FabricId; name: string; label: string; description: string; color: string;
  weightGsm: number; stretch: number; drape: number; stability: number;
  roughness: number; cutTolerance: number; sewingTolerance: number;
  idealPedal: number; idealTension: number; drift: number;
}
export interface PatternPiece { id: string; label: string; outline: Point[]; seams: Point[][] }
export interface PatternDefinition {
  id: GarmentKind; name: string; label: string; description: string; difficulty: number;
  recommendedFabrics: FabricId[]; pieces: PatternPiece[];
}
export interface OperationResult { id: string; score: number; attempts: number; samples: number }
export interface CutState {
  pieceIndex: number; distance: number; started: boolean; lastPoint: Point | null;
  samples: number; errorSum: number; travelled: number; attempts: number;
  trace: Point[]; results: OperationResult[];
}
export interface SewState {
  seamIndex: number; distance: number; offset: number; tension: number; speed: number;
  samples: number; errorSum: number; travelled: number; attempts: number;
  trace: Point[]; results: OperationResult[];
}
export interface TailoringRun {
  design: TailoringDesign; cut: CutState; sew: SewState;
}
export interface CraftedGarment {
  id: string; name: string; createdAt: string; descriptor: GarmentDescriptor;
  cutScore: number; sewScore: number; materialScore: number; grade: string;
  xp: number;
}
export interface TailoringState {
  version: 1; stage: TailoringStage; design: TailoringDesign;
  run: TailoringRun | null; inventory: CraftedGarment[]; xp: number;
  nextItemId: number; lastFinishedId: string | null;
}
export interface TailoringStorage {
  getItem(key: string): string | null; setItem(key: string, value: string): void;
}
export interface TailoringRunView {
  piece: PatternPiece; pieceIndex: number; pieceCount: number;
  seam: Point[]; seamIndex: number; seamCount: number; seamLabel: string;
  cutProgress: number; cutPrecision: number; totalCutProgress: number;
  sewProgress: number; sewPrecision: number; totalSewProgress: number;
  cuttingPoint: Point; sewingPoint: Point; needlePoint: Point;
  tension: number; idealTension: number; speed: number; offset: number;
  cutsComplete: boolean; seamsComplete: boolean; quality: number;
}

export const INVENTORY_LIMIT = 48;
const TRACE_LIMIT = 600;
const SAVE_TEXT_LIMIT = 256 * 1024;
const MAX_XP = 1_000_000;
const point = (x: number, y: number): Point => ({ x, y });
const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const roundScore = (value: number): number => Math.round(clamp(value, 0, 100));
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const average = (values: number[]): number => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 100;
const validColor = (value: unknown): value is string => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);

export const FABRICS: FabricDefinition[] = [
  { id: 'denim', name: t`原色斜纹牛仔`, label: t`牛仔布`, description: t`厚实斜纹，结构挺括。慢速压线能留下干净的双线轮廓。`, color: '#304b72', weightGsm: 340, stretch: .08, drape: .25, stability: .92, roughness: .87, cutTolerance: .022, sewingTolerance: .026, idealPedal: .48, idealTension: .72, drift: .024 },
  { id: 'jersey', name: t`精梳棉针织`, label: t`棉针织`, description: t`柔软有弹性，适合日常 T 恤。放慢速度，避免把布边拉长。`, color: '#eadcc5', weightGsm: 190, stretch: .78, drape: .72, stability: .58, roughness: .94, cutTolerance: .026, sewingTolerance: .029, idealPedal: .52, idealTension: .4, drift: .038 },
  { id: 'linen', name: t`水洗亚麻`, label: t`亚麻`, description: t`自然纤维有清晰纹理，凉爽而松弛。转弯时轻扶布边。`, color: '#c2aa85', weightGsm: 180, stretch: .06, drape: .58, stability: .8, roughness: .96, cutTolerance: .024, sewingTolerance: .026, idealPedal: .57, idealTension: .56, drift: .028 },
  { id: 'satin', name: t`丝光缎面`, label: t`缎面`, description: t`细腻光泽与流动垂感。布面容易滑动，需要轻踩踏板、持续修正。`, color: '#a65672', weightGsm: 115, stretch: .12, drape: .98, stability: .34, roughness: .32, cutTolerance: .019, sewingTolerance: .023, idealPedal: .38, idealTension: .34, drift: .056 },
];

export const FITS: { id: FitId; name: string; label: string; description: string }[] = [
  { id: 'regular', name: t`经典合身`, label: t`经典`, description: t`平衡肩宽与活动空间。` },
  { id: 'relaxed', name: t`宽松剪裁`, label: t`宽松`, description: t`更宽的衣身、裤管与裙摆。` },
  { id: 'fitted', name: t`收腰修身`, label: t`修身`, description: t`贴合轮廓，曲线缝合更考验稳定。` },
];

const shirtFront = [point(.36,.13),point(.4,.21),point(.5,.235),point(.6,.21),point(.64,.13),point(.82,.22),point(.73,.4),point(.65,.35),point(.65,.88),point(.35,.88),point(.35,.35),point(.27,.4),point(.18,.22),point(.36,.13)];
const shirtBack = [point(.36,.13),point(.43,.155),point(.57,.155),point(.64,.13),point(.82,.22),point(.73,.4),point(.65,.35),point(.65,.88),point(.35,.88),point(.35,.35),point(.27,.4),point(.18,.22),point(.36,.13)];
const sleeve = [point(.22,.36),point(.29,.24),point(.4,.17),point(.5,.15),point(.6,.17),point(.71,.24),point(.78,.36),point(.68,.79),point(.32,.79),point(.22,.36)];
const legFront = [point(.33,.13),point(.65,.13),point(.67,.32),point(.73,.43),point(.63,.49),point(.61,.9),point(.4,.9),point(.36,.5),point(.27,.4),point(.33,.13)];
const legBack = [point(.32,.13),point(.67,.12),point(.7,.29),point(.78,.42),point(.65,.5),point(.62,.9),point(.4,.9),point(.34,.5),point(.23,.39),point(.32,.13)];
const bodice = [point(.35,.15),point(.41,.23),point(.5,.25),point(.59,.23),point(.65,.15),point(.76,.27),point(.67,.42),point(.62,.5),point(.61,.82),point(.39,.82),point(.38,.5),point(.33,.42),point(.24,.27),point(.35,.15)];
const skirt = [point(.38,.15),point(.62,.15),point(.69,.43),point(.83,.87),point(.67,.9),point(.5,.91),point(.33,.9),point(.17,.87),point(.31,.43),point(.38,.15)];
const mirror = (path: Point[]): Point[] => path.map(p => point(1-p.x,p.y));
const piece = (id: string, label: string, outline: Point[], seams: Point[][]): PatternPiece => ({ id,label,outline,seams });

export const PATTERNS: PatternDefinition[] = [
  { id:'tshirt', name:t`日常短袖上衣`, label:t`T 恤`, description:t`女款圆领 T 恤，男款翻领短袖。练习平整袖口和柔软织物的送布。`, difficulty:1, recommendedFabrics:['jersey','linen'], pieces:[
    piece('front',t`前衣片`,shirtFront,[[point(.37,.36),point(.37,.62),point(.37,.85)],[point(.38,.85),point(.5,.85),point(.62,.85)]]),
    piece('back',t`后衣片`,shirtBack,[[point(.63,.36),point(.63,.62),point(.63,.85)]]),
    piece('left-sleeve',t`左袖片`,sleeve,[[point(.25,.37),point(.32,.27),point(.41,.2),point(.5,.18),point(.59,.2),point(.68,.27),point(.75,.37)]]),
    piece('right-sleeve',t`右袖片`,mirror(sleeve),[[point(.34,.76),point(.5,.76),point(.66,.76)]]),
  ]},
  { id:'jeans', name:t`经典直筒牛仔裤`, label:t`牛仔裤`, description:t`独立前后裤片、腰头与耐用压线。厚布以稳定慢速送入针脚。`, difficulty:2, recommendedFabrics:['denim'], pieces:[
    piece('left-front',t`左前裤片`,legFront,[[point(.36,.17),point(.32,.38),point(.39,.48),point(.43,.87)]]),
    piece('right-front',t`右前裤片`,mirror(legFront),[[point(.64,.17),point(.68,.38),point(.61,.48),point(.57,.87)]]),
    piece('back',t`后裤片（对称裁）`,legBack,[[point(.65,.17),point(.67,.3),point(.74,.41),point(.62,.49),point(.59,.87)],[point(.43,.87),point(.5,.87),point(.58,.87)]]),
    piece('waistband',t`独立腰头`, [point(.16,.34),point(.84,.34),point(.84,.64),point(.16,.64),point(.16,.34)],[[point(.19,.38),point(.5,.38),point(.81,.38)]]),
  ]},
  { id:'dress', name:t`收腰伞摆连衣裙`, label:t`连衣裙`, description:t`胸省、腰缝和宽阔裙摆组成完整轮廓。缎面会考验手部微调。`, difficulty:3, recommendedFabrics:['linen','satin','jersey'], pieces:[
    piece('bodice-front',t`前身衣片`,bodice,[[point(.37,.44),point(.4,.59),point(.42,.79)]]),
    piece('bodice-back',t`后身衣片`,bodice.map(p => point(p.x,p.y)),[[point(.63,.44),point(.6,.59),point(.58,.79)]]),
    piece('skirt-front',t`前裙片`,skirt,[[point(.4,.18),point(.5,.18),point(.6,.18)],[point(.22,.85),point(.36,.87),point(.5,.88),point(.64,.87),point(.78,.85)]]),
    piece('skirt-back',t`后裙片`,skirt,[[point(.4,.18),point(.33,.45),point(.21,.85)]]),
  ]},
];


export const DEFAULT_DESIGN: TailoringDesign = { kind:'tshirt',fabric:'jersey',color:'#eadcc5',threadColor:'#f1e5cf',fit:'regular' };
const fabricFor = (id: FabricId): FabricDefinition => FABRICS.find(f=>f.id===id)!;
const patternFor = (id: GarmentKind): PatternDefinition => PATTERNS.find(p=>p.id===id)!;
export const getFabric = fabricFor;
export const getPattern = patternFor;

/** Distance-parametrised paths keep pointer and machine progress independent of vertex density. */
export function pathLength(path: readonly Point[]): number {
  let length=0; for(let i=1;i<path.length;i++) length+=distance(path[i-1],path[i]); return length;
}
export function interpolatePath(path: readonly Point[], atDistance: number): Point {
  if(!path.length) return point(.5,.5);
  let remaining=Math.max(0,finite(atDistance)?atDistance:0);
  for(let i=1;i<path.length;i++) { const length=distance(path[i-1],path[i]); if(length>0 && remaining<=length) { const t=remaining/length; return point(path[i-1].x+(path[i].x-path[i-1].x)*t,path[i-1].y+(path[i].y-path[i-1].y)*t); } remaining-=length; }
  return {...path[path.length-1]};
}
export function resamplePath(path: readonly Point[], spacing=.012): Point[] {
  const length=pathLength(path), step=clamp(finite(spacing)?spacing:.012,.002,1);
  const count=Math.max(1,Math.ceil(length/step)); return Array.from({length:count+1},(_,i)=>interpolatePath(path,length*i/count));
}
export function pathPointAt(path: readonly Point[], progress: number): Point { return interpolatePath(path,pathLength(path)*clamp(progress)); }

/** Returned geometry is a copy; changing fit never mutates the pattern catalog. */
export function getPatternPieces(design: TailoringDesign): PatternPiece[] {
  const width=design.fit==='relaxed'?1.13:design.fit==='fitted'?.88:1;
  const transform=(p:Point):Point=>point(clamp(.5+(p.x-.5)*width,.04,.96),p.y);
  return patternFor(design.kind).pieces.map(p=>({...p,outline:p.outline.map(transform),seams:p.seams.map(s=>s.map(transform))}));
}
function allSeams(design: TailoringDesign): { id:string; label:string; pieceIndex:number; path:Point[] }[] {
  return getPatternPieces(design).flatMap((p,pieceIndex)=>p.seams.map((path,i)=>({id:`${p.id}:${i}`,label:i===0?t`${p.label} · 接合缝`:t`${p.label} · 折边压线`,pieceIndex,path})));
}
function emptyCut():CutState { return {pieceIndex:0,distance:0,started:false,lastPoint:null,samples:0,errorSum:0,travelled:0,attempts:1,trace:[],results:[]}; }
function emptySew(fabric:FabricId):SewState { return {seamIndex:0,distance:0,offset:0,tension:fabricFor(fabric).idealTension,speed:0,samples:0,errorSum:0,travelled:0,attempts:1,trace:[],results:[]}; }
export function createTailoringState():TailoringState { return {version:1,stage:'design',design:{...DEFAULT_DESIGN},run:null,inventory:[],xp:0,nextItemId:1,lastFinishedId:null}; }
export function configureDesign(state:TailoringState, patch:Partial<TailoringDesign>):TailoringState {
  if(state.stage!=='design') return state;
  const design={...state.design};
  if(patch.kind && PATTERNS.some(p=>p.id===patch.kind)) design.kind=patch.kind;
  if(patch.fabric && FABRICS.some(f=>f.id===patch.fabric)) design.fabric=patch.fabric;
  if(patch.fit && FITS.some(f=>f.id===patch.fit)) design.fit=patch.fit;
  if(validColor(patch.color)) design.color=patch.color.toLowerCase();
  if(validColor(patch.threadColor)) design.threadColor=patch.threadColor.toLowerCase();
  return {...state,design};
}
export function startNewDesign(state:TailoringState):TailoringState { return {...state,stage:'design',run:null,lastFinishedId:null}; }
export function showWardrobe(state:TailoringState):TailoringState {
  // Opening the wardrobe does not discard a workpiece; the host can hide its panel instead.
  return state.run && (state.stage==='cut'||state.stage==='sew'||state.stage==='finish')?state:{...state,stage:'wardrobe'};
}
export function startCutting(state:TailoringState):TailoringState {
  if(state.stage!=='design') return state;
  return {...state,stage:'cut',run:{design:{...state.design},cut:emptyCut(),sew:emptySew(state.design.fabric)}};
}

function appendTrace(trace:Point[],sample:Point):Point[] {
  if(trace.length && distance(trace[trace.length-1],sample)<.002) return trace;
  const next=[...trace,{...sample}];
  // Keep the whole silhouette represented when a very slow hand supplies many samples.
  return next.length>TRACE_LIMIT ? next.filter((_,i)=>i%2===0 || i===next.length-1) : next;
}
function precision(errorSum:number,travelled:number):number { return travelled>0?roundScore(100*Math.exp(-errorSum/travelled)):100; }
function projectForward(path:Point[],sample:Point,from:number,to:number):{distance:number;error:number} {
  let travelled=0,best={distance:from,error:Infinity};
  for(let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i],length=distance(a,b),start=Math.max(0,(from-travelled)/(length||1)),end=Math.min(1,(to-travelled)/(length||1));
    if(length>0 && start<=end && end>=0 && start<=1) {
      const t=clamp(((sample.x-a.x)*(b.x-a.x)+(sample.y-a.y)*(b.y-a.y))/(length*length),Math.max(0,start),Math.min(1,end));
      const error=distance(sample,point(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t));
      if(error<best.error) best={distance:travelled+length*t,error};
    }
    travelled+=length;
  }
  return best;
}

/** The cursor must traverse the next arc of the contour; clicks on later vertices cannot skip cloth. */
export function traceCut(state:TailoringState,sample:Point,deltaSeconds:number):TailoringState {
  if(state.stage!=='cut'||!state.run||!finite(sample.x)||!finite(sample.y)||!finite(deltaSeconds)||deltaSeconds<=0) return state;
  if(sample.x<-.1||sample.x>1.1||sample.y<-.1||sample.y>1.1) return state;
  const run=state.run,cut=run.cut,pieces=getPatternPieces(run.design),current=pieces[cut.pieceIndex]; if(!current) return state;
  const fabric=fabricFor(run.design.fabric),path=current.outline,length=pathLength(path),dt=clamp(deltaSeconds,.001,.1);
  if(!cut.started) {
    if(distance(sample,path[0])>fabric.cutTolerance*2.2) return state;
    return {...state,run:{...run,cut:{...cut,started:true,lastPoint:{...sample},trace:[{...sample}],samples:1}}};
  }
  const maxAdvance=dt*1.8+.012;
  if(cut.lastPoint && distance(cut.lastPoint,sample)>maxAdvance*1.5) return state;
  const projection=projectForward(path,sample,Math.max(0,cut.distance-.008),Math.min(length,cut.distance+maxAdvance));
  if(projection.error>fabric.cutTolerance*4.5) return {...state,run:{...run,cut:{...cut,lastPoint:{...sample}}}};
  const advance=Math.max(0,projection.distance-cut.distance); if(advance<.00005) return {...state,run:{...run,cut:{...cut,lastPoint:{...sample}}}};
  const next:CutState={...cut,distance:Math.max(cut.distance,projection.distance),lastPoint:{...sample},samples:cut.samples+1,travelled:cut.travelled+advance,errorSum:cut.errorSum+(projection.error/fabric.cutTolerance)*advance,trace:appendTrace(cut.trace,sample)};
  if(next.distance>=length-.003 && distance(sample,path[path.length-1])<=fabric.cutTolerance*2.2) {
    const result={id:current.id,score:precision(next.errorSum,next.travelled),attempts:cut.attempts,samples:next.samples};
    return {...state,run:{...run,cut:{...emptyCut(),pieceIndex:cut.pieceIndex+1,results:[...cut.results,result]}}};
  }
  return {...state,run:{...run,cut:next}};
}
export function resetCurrentPiece(state:TailoringState):TailoringState {
  if(state.stage!=='cut'||!state.run) return state;
  const cut=state.run.cut,pieces=getPatternPieces(state.run.design); if(cut.pieceIndex>=pieces.length) return state;
  return {...state,run:{...state.run,cut:{...emptyCut(),pieceIndex:cut.pieceIndex,results:cut.results,attempts:Math.min(999,cut.attempts+1)}}};
}
export function startSewing(state:TailoringState):TailoringState {
  if(state.stage!=='cut'||!state.run||state.run.cut.results.length!==getPatternPieces(state.run.design).length) return state;
  return {...state,stage:'sew'};
}

/** Feed is distance based and capped to a visible frame. Holding the pedal with no steering drifts off line. */
export function advanceSewing(state:TailoringState,input:{deltaSeconds:number;pedal:number;steer:number;tension?:number}):TailoringState {
  if(state.stage!=='sew'||!state.run||!finite(input.deltaSeconds)||input.deltaSeconds<=0||!finite(input.pedal)||!finite(input.steer)) return state;
  const run=state.run,sew=run.sew,seams=allSeams(run.design),seam=seams[sew.seamIndex]; if(!seam) return state;
  const fabric=fabricFor(run.design.fabric),dt=clamp(input.deltaSeconds,0,.1),pedal=clamp(input.pedal),steer=clamp(input.steer,-1,1);
  const tension=finite(input.tension)?clamp(input.tension):sew.tension;
  const speed=pedal*.36*(1-fabric.weightGsm/1500);
  const length=pathLength(seam.path),advance=Math.min(length-sew.distance,speed*dt);
  const drift=(Math.sin(sew.distance*23+sew.seamIndex*1.7)*.65+.62)*fabric.drift*(.5+pedal*1.3);
  const offset=clamp(sew.offset+steer*.21*dt+drift*dt*pedal,-.16,.16);
  if(advance<=0) return {...state,run:{...run,sew:{...sew,offset,tension,speed:0}}};
  const overspeed=Math.max(0,pedal-fabric.idealPedal-.08)*1.7;
  const tensionError=Math.abs(tension-fabric.idealTension)*1.2;
  const error=(Math.abs(offset)/fabric.sewingTolerance)*.63+overspeed+tensionError;
  const position=interpolatePath(seam.path,sew.distance+advance),tangent=pathTangent(seam.path,sew.distance+advance);
  const next:SewState={...sew,distance:sew.distance+advance,offset,tension,speed,samples:sew.samples+1,travelled:sew.travelled+advance,errorSum:sew.errorSum+error*advance,trace:appendTrace(sew.trace,point(position.x-tangent.y*offset,position.y+tangent.x*offset))};
  if(next.distance>=length-.00001) {
    const result={id:seam.id,score:precision(next.errorSum,next.travelled),attempts:sew.attempts,samples:next.samples};
    const finished={...emptySew(run.design.fabric),seamIndex:sew.seamIndex+1,tension,results:[...sew.results,result]};
    return {...state,stage:finished.seamIndex===seams.length?'finish':'sew',run:{...run,sew:finished}};
  }
  return {...state,run:{...run,sew:next}};
}
function pathTangent(path:Point[],atDistance:number):Point {
  const a=interpolatePath(path,Math.max(0,atDistance-.002)),b=interpolatePath(path,Math.min(pathLength(path),atDistance+.002));
  const length=distance(a,b)||1; return point((b.x-a.x)/length,(b.y-a.y)/length);
}
export function resetCurrentSeam(state:TailoringState):TailoringState {
  if(state.stage!=='sew'||!state.run) return state;
  const sew=state.run.sew; return {...state,run:{...state.run,sew:{...emptySew(state.run.design.fabric),seamIndex:sew.seamIndex,results:sew.results,tension:sew.tension,attempts:Math.min(999,sew.attempts+1)}}};
}
export function materialSuitability(design:TailoringDesign):number {
  const scores:Record<GarmentKind,Record<FabricId,number>>={tshirt:{jersey:100,linen:88,denim:52,satin:72},jeans:{denim:100,linen:65,jersey:48,satin:35},dress:{linen:96,satin:100,jersey:92,denim:70}};
  return scores[design.kind][design.fabric];
}
export function qualityGrade(quality:number):string { return quality>=92?t`S · 匠心`:quality>=82?t`A · 精制`:quality>=68?t`B · 日常`:quality>=48?t`C · 练习`:t`D · 待改进`; }
export function tailoringLevel(xp:number):number { return 1+Math.floor(Math.sqrt(Math.max(0,xp)/120)); }
export function levelProgress(xp:number):{level:number;current:number;needed:number;progress:number} {
  const level=tailoringLevel(xp),floor=(level-1)**2*120,next=level**2*120;
  return {level,current:xp-floor,needed:next-floor,progress:clamp((xp-floor)/(next-floor))};
}
export function evaluateRun(run:TailoringRun):{cutScore:number;sewScore:number;materialScore:number;quality:number;grade:string;xp:number} {
  const cutScore=roundScore(average(run.cut.results.map(r=>r.score))),sewScore=roundScore(average(run.sew.results.map(r=>r.score))),materialScore=materialSuitability(run.design);
  const quality=roundScore(cutScore*.38+sewScore*.5+materialScore*.12);
  return {cutScore,sewScore,materialScore,quality,grade:qualityGrade(quality),xp:Math.round(20+quality*.5)};
}
export function finishGarment(state:TailoringState,now:number=Date.now()):TailoringState {
  if(state.stage!=='finish'||!state.run||!finite(now)||now<0||now>8.64e15) return state;
  const run=state.run;
  if(run.cut.results.length!==getPatternPieces(run.design).length||run.sew.results.length!==allSeams(run.design).length) return state;
  const result=evaluateRun(run),id=`atelier-${Math.trunc(now).toString(36)}-${state.nextItemId.toString(36)}`;
  const item:CraftedGarment={id,name:`${fabricFor(run.design.fabric).label} · ${patternFor(run.design.kind).label}`,createdAt:new Date(now).toISOString(),descriptor:{...run.design,quality:result.quality},cutScore:result.cutScore,sewScore:result.sewScore,materialScore:result.materialScore,grade:result.grade,xp:result.xp};
  return {...state,stage:'wardrobe',run:null,inventory:[item,...state.inventory].slice(0,INVENTORY_LIMIT),xp:Math.min(MAX_XP,state.xp+result.xp),nextItemId:state.nextItemId+1,lastFinishedId:id};
}

export function getRunView(state:TailoringState):TailoringRunView {
  const design=state.run?.design??state.design,pieces=getPatternPieces(design),seams=allSeams(design),cut=state.run?.cut??emptyCut(),sew=state.run?.sew??emptySew(design.fabric);
  const cutsComplete=cut.pieceIndex>=pieces.length,seamsComplete=sew.seamIndex>=seams.length;
  const currentSeam=seams[Math.min(sew.seamIndex,seams.length-1)];
  const pieceIndex=state.stage==='sew'||state.stage==='finish'?currentSeam.pieceIndex:Math.min(cut.pieceIndex,pieces.length-1),currentPiece=pieces[pieceIndex];
  const currentCut=pieces[Math.min(cut.pieceIndex,pieces.length-1)],cutProgress=cutsComplete?1:clamp(cut.distance/pathLength(currentCut.outline));
  const sewProgress=seamsComplete?1:clamp(sew.distance/pathLength(currentSeam.path)),sewingPoint=interpolatePath(currentSeam.path,seamsComplete?pathLength(currentSeam.path):sew.distance),tangent=pathTangent(currentSeam.path,sew.distance);
  return {piece:currentPiece,pieceIndex,pieceCount:pieces.length,seam:currentSeam.path,seamIndex:Math.min(sew.seamIndex,seams.length-1),seamCount:seams.length,seamLabel:currentSeam.label,cutProgress,cutPrecision:precision(cut.errorSum,cut.travelled),totalCutProgress:(Math.min(cut.pieceIndex,pieces.length)+(cutsComplete?0:cutProgress))/pieces.length,sewProgress,sewPrecision:precision(sew.errorSum,sew.travelled),totalSewProgress:(Math.min(sew.seamIndex,seams.length)+(seamsComplete?0:sewProgress))/seams.length,cuttingPoint:interpolatePath(currentCut.outline,cutsComplete?pathLength(currentCut.outline):cut.distance),sewingPoint,needlePoint:point(sewingPoint.x-tangent.y*sew.offset,sewingPoint.y+tangent.x*sew.offset),tension:sew.tension,idealTension:fabricFor(design.fabric).idealTension,speed:sew.speed,offset:sew.offset,cutsComplete,seamsComplete,quality:state.run?evaluateRun(state.run).quality:100};
}

function object(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('Invalid atelier record');
  return value as Record<string,unknown>;
}
function number(value:unknown,min:number,max:number,integer=false):number {
  if(!finite(value)||value<min||value>max||(integer&&!Number.isInteger(value))) throw new Error('Invalid atelier number'); return value;
}
function textValue(value:unknown,max=160):string { if(typeof value!=='string'||value.length>max) throw new Error('Invalid atelier text'); return value; }
function knownId<T extends string>(value:unknown,values:readonly T[]):T {
  if(typeof value!=='string'||!values.includes(value as T)) throw new Error('Invalid atelier option'); return value as T;
}
function parseDesign(value:unknown):TailoringDesign {
  const data=object(value);
  if(!validColor(data.color)||!validColor(data.threadColor)) throw new Error('Invalid atelier colour');
  return {kind:knownId(data.kind,['tshirt','jeans','dress']),fabric:knownId(data.fabric,['denim','jersey','linen','satin']),fit:knownId(data.fit,['regular','relaxed','fitted']),color:data.color.toLowerCase(),threadColor:data.threadColor.toLowerCase()};
}
function parsePoint(value:unknown):Point { const data=object(value); return point(number(data.x,-.25,1.25),number(data.y,-.25,1.25)); }
function parseTrace(value:unknown):Point[] { if(!Array.isArray(value)||value.length>TRACE_LIMIT) throw new Error('Invalid atelier trace'); return value.map(parsePoint); }
function parseResults(value:unknown,ids:string[]):OperationResult[] {
  if(!Array.isArray(value)||value.length>ids.length) throw new Error('Invalid atelier results');
  return value.map((entry,i)=>{const data=object(entry); if(data.id!==ids[i]) throw new Error('Invalid atelier result order'); return {id:ids[i],score:number(data.score,0,100),attempts:number(data.attempts,1,999,true),samples:number(data.samples,2,1e7,true)};});
}
function parseRun(value:unknown,stage:TailoringStage):TailoringRun {
  const data=object(value),design=parseDesign(data.design),cutData=object(data.cut),sewData=object(data.sew),pieces=getPatternPieces(design),seams=allSeams(design);
  const pieceIndex=number(cutData.pieceIndex,0,pieces.length,true),seamIndex=number(sewData.seamIndex,0,seams.length,true);
  const cutResults=parseResults(cutData.results,pieces.map(p=>p.id)),sewResults=parseResults(sewData.results,seams.map(s=>s.id));
  if(cutResults.length!==pieceIndex||sewResults.length!==seamIndex) throw new Error('Invalid atelier progress');
  const cutLength=pieces[pieceIndex]?pathLength(pieces[pieceIndex].outline):0,sewLength=seams[seamIndex]?pathLength(seams[seamIndex].path):0;
  if(typeof cutData.started!=='boolean') throw new Error('Invalid cutting state');
  const cut:CutState={pieceIndex,distance:number(cutData.distance,0,cutLength),started:cutData.started,lastPoint:cutData.lastPoint===null?null:parsePoint(cutData.lastPoint),samples:number(cutData.samples,0,1e7,true),errorSum:number(cutData.errorSum,0,cutLength*4.6),travelled:number(cutData.travelled,0,cutLength+.001),attempts:number(cutData.attempts,1,999,true),trace:parseTrace(cutData.trace),results:cutResults};
  const sew:SewState={seamIndex,distance:number(sewData.distance,0,sewLength),offset:number(sewData.offset,-.16,.16),tension:number(sewData.tension,0,1),speed:number(sewData.speed,0,.36),samples:number(sewData.samples,0,1e7,true),errorSum:number(sewData.errorSum,0,sewLength*10),travelled:number(sewData.travelled,0,sewLength+.001),attempts:number(sewData.attempts,1,999,true),trace:parseTrace(sewData.trace),results:sewResults};
  if(Math.abs(cut.travelled-cut.distance)>.002||Math.abs(sew.travelled-sew.distance)>.002) throw new Error('Invalid atelier travelled distance');
  if(cut.started && (!cut.lastPoint||cut.samples<1||!cut.trace.length)) throw new Error('Missing cutting contact');
  if(!cut.started && (cut.distance!==0||cut.samples!==0||cut.lastPoint!==null||cut.trace.length!==0)) throw new Error('Unexpected cutting contact');
  if((stage==='sew'||stage==='finish')&&pieceIndex!==pieces.length) throw new Error('Uncut pattern');
  if(stage==='cut'&&(seamIndex!==0||sew.distance!==0||sew.samples!==0||sew.trace.length!==0)) throw new Error('Sewing before cutting');
  if(stage==='finish'&&seamIndex!==seams.length) throw new Error('Unfinished seams');
  if(stage==='sew'&&seamIndex===seams.length) throw new Error('Finished machine state');
  return {design,cut,sew};
}
function parseGarment(value:unknown):CraftedGarment {
  const data=object(value),descriptorData=object(data.descriptor),design=parseDesign(descriptorData),quality=number(descriptorData.quality,0,100),createdAt=textValue(data.createdAt,40),timestamp=Date.parse(createdAt);
  if(!Number.isFinite(timestamp)||timestamp<0||new Date(timestamp).toISOString()!==createdAt) throw new Error('Invalid atelier timestamp');
  return {id:textValue(data.id,100),name:textValue(data.name,120),createdAt,descriptor:{...design,quality},cutScore:number(data.cutScore,0,100),sewScore:number(data.sewScore,0,100),materialScore:number(data.materialScore,0,100),grade:textValue(data.grade,40),xp:number(data.xp,0,1000,true)};
}
/** Strict parser for tests/imports. Invalid local files never become live gameplay state. */
export function parseTailoringState(value:unknown):TailoringState {
  if(typeof value==='string'&&value.length>SAVE_TEXT_LIMIT) throw new Error('Atelier save is too large');
  const data=object(typeof value==='string'?JSON.parse(value):value);
  if(data.version!==1) throw new Error('Unsupported atelier save');
  const stage=knownId(data.stage,['design','cut','sew','finish','wardrobe']),design=parseDesign(data.design);
  if(!Array.isArray(data.inventory)||data.inventory.length>INVENTORY_LIMIT) throw new Error('Invalid wardrobe');
  const inventory=data.inventory.map(parseGarment);
  if(new Set(inventory.map(item=>item.id)).size!==inventory.length) throw new Error('Duplicate atelier items');
  const run=data.run===null?null:parseRun(data.run,stage);
  if((stage==='cut'||stage==='sew'||stage==='finish')!==!!run) throw new Error('Invalid atelier stage');
  if(run&&(JSON.stringify(run.design)!==JSON.stringify(design))) throw new Error('Mismatched atelier design');
  const lastFinishedId=data.lastFinishedId===null?null:textValue(data.lastFinishedId,100);
  if(lastFinishedId!==null&&!inventory.some(item=>item.id===lastFinishedId)) throw new Error('Missing finished garment');
  return {version:1,stage,design,run,inventory,xp:number(data.xp,0,MAX_XP,true),nextItemId:number(data.nextItemId,1,Number.MAX_SAFE_INTEGER-1,true),lastFinishedId};
}
export function serializeTailoringState(state:TailoringState):string { return JSON.stringify(parseTailoringState(state)); }
export function restoreTailoringState(value:unknown):TailoringState { try { return parseTailoringState(value); } catch { return createTailoringState(); } }
/** Stores a validated atelier session under the supplied browser storage key. */
export function loadTailoringState(storage:TailoringStorage,key:string):TailoringState {
  try { const saved=storage.getItem(key); return saved===null?createTailoringState():restoreTailoringState(saved); } catch { return createTailoringState(); }
}
export function saveTailoringState(storage:TailoringStorage,key:string,state:TailoringState):boolean {
  try { storage.setItem(key,serializeTailoringState(state)); return true; } catch { return false; }
}
