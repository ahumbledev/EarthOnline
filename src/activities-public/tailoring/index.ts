import * as THREE from 'three';
import {textileUrl} from './materials.ts';
import type {GameView,GameViewContext,RenderQuality} from '../view.ts';
import { createAtelierScene } from './scene';
import { garmentIcon, scissorsIcon, needleIcon, hangerIcon, starIcon } from './icons';
import {
  FABRICS, PATTERNS, FITS, createTailoringState, configureDesign, startCutting,
  traceCut, resetCurrentPiece, startSewing, advanceSewing, resetCurrentSeam, finishGarment,
  startNewDesign, showWardrobe, loadTailoringState, saveTailoringState, getRunView,
  getFabric, getPattern, getPatternPieces, materialSuitability, qualityGrade, levelProgress,
  evaluateRun, pathPointAt,
  type TailoringState, type TailoringDesign, type Point, type CraftedGarment,
} from './game';
import { createTailoringAudio } from './audio';
import './style.css';
import { t, td } from '../language.ts';
import { createActivityControls } from '../common/controls';
import { createActivityPanel } from '../common/panel';

const DYES = [
  { color:'#eadcc5',name:t`原棉白` },{ color:'#304b72',name:t`靛蓝` },{ color:'#7c9284',name:t`鼠尾草` },
  { color:'#a65672',name:t`蔷薇` },{ color:'#c2aa85',name:t`燕麦` },{ color:'#354447',name:t`墨青` },
];
const THREADS = [{color:'#f1e5cf',name:t`本白`},{color:'#c99855',name:t`金棕`},{color:'#354447',name:t`墨青`},{color:'#a65672',name:t`蔷薇`}];
const pct = (value:number) => `${Math.round(Math.max(0,Math.min(1,value))*100)}%`;
const clamp = (n:number,min=-1,max=1) => Math.max(min,Math.min(max,n));
const pathD = (points:readonly Point[]) => points.map((p,i)=>`${i?'L':'M'}${(p.x*100).toFixed(3)},${(p.y*100).toFixed(3)}`).join(' ');
const escape = (value:string) => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export function createTailoringView(context:GameViewContext,exit:()=>void):GameView {
  const {container,renderer}=context;
  const abort=new AbortController();
  const storageKey='workshop:tailoring:v1';
  let storage:Storage|undefined;
  try { storage=window.localStorage; } catch { /* The atelier remains playable during this session. */ }
  let state=storage?loadTailoringState(storage,storageKey):createTailoringState();
  let active=false,disposed=false,lastFrame=0,lastHud=0,lastSave=0,dirty=false,toastUntil=0;
  let visibleStage=state.stage;
  let selectedId:string|null=state.lastFinishedId??state.inventory[0]?.id??null;
  let pedalHeld=false,steerHeld=0,pedalSpeed=.48,threadTension=state.run?.sew.tension??getFabric(state.design.fabric).idealTension;
  let pointer: {id:number;point:Point}|null=null;
  let keyboardCursor:Point={...getRunView(state).cuttingPoint};
  let boardKey='';
  const keys=new Set<string>();
  const scene=createAtelierScene(renderer);
  const audio=createTailoringAudio();
  container.innerHTML=`<main class="atelier">
    <header class="atelier-header"><div class="atelier-brand"><span>${scissorsIcon}</span><div><strong>${'Sewing'}</strong><small>${t`裁缝工坊`}</small></div></div>
      <ol class="atelier-steps" aria-label="${t`制衣步骤`}"><li data-step="design"><span>1</span>${t`选布选版`}</li><li data-step="cut"><span>2</span>${t`手工裁剪`}</li><li data-step="sew"><span>3</span>${t`缝纫制作`}</li><li data-step="finish"><span>4</span>${'Finish'}</li></ol>
    </header>
    <section class="atelier-stage" aria-label="${t`裁缝工作台`}"><div class="atelier-canvas"></div>
      <div class="atelier-title"><p data-stage-kicker>${t`从一块好布开始`}</p><h1 data-stage-title>${t`从布料，到衣橱。`}</h1><span data-stage-description>${t`选一块喜欢的布，慢慢把它变成日常。`}</span></div>
      <div class="atelier-operation" hidden><div class="atelier-operation-head"><b data-operation-title></b><span data-operation-count></span></div><div class="atelier-cut-progress"><span data-operation-progress></span></div>
        <div class="atelier-board-wrap"><svg class="atelier-board" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" tabindex="0" role="application" aria-label="${t`裁剪与缝线操作台`}"></svg><span class="atelier-board-error" data-board-hint></span></div>
        <div class="atelier-operation-foot"><span data-operation-hint></span><button class="atelier-retry" data-action="redo" type="button">${t`重新裁这一片`}</button></div></div>
      <div class="atelier-needle-gauge" aria-label="${t`当前针脚精度`}" hidden><svg viewBox="0 0 60 60" aria-hidden="true"><circle class="needle-gauge-track" cx="30" cy="30" r="25"/><circle class="needle-gauge-value" cx="30" cy="30" r="25" pathLength="100"/></svg><strong>100</strong><small>${t`针迹`}</small></div>
    </section>
    <aside class="atelier-cabinet" aria-label="${t`制衣工具与布料`}"></aside>
    <footer class="atelier-footer"><div class="atelier-footer-left"><button type="button" class="atelier-back" data-action="leave"><span aria-hidden="true">‹</span>${t`返回`}</button><button type="button" class="atelier-wardrobe-button" data-action="wardrobe">${hangerIcon}<span>${t`我的衣柜`}</span><b data-inventory-count>0</b></button><button type="button" class="atelier-sound" data-action="sound" aria-pressed="${!audio.muted}">${audio.muted?t`音效关`:t`音效开`}</button><span class="atelier-save" role="status" data-save-status>${t`制作进度和衣柜保存在此浏览器`}</span></div><div class="atelier-actions"><span data-action-hint></span><button class="atelier-primary" data-action="primary" type="button"></button></div></footer>
    <div class="atelier-toast" role="status" aria-live="polite" hidden></div>
  </main>`;
  const get=<T extends Element=HTMLElement>(selector:string)=>container.querySelector<T>(selector)!;
  const root=get<HTMLElement>('.atelier'),host=get<HTMLElement>('.atelier-canvas'),cabinet=get<HTMLElement>('.atelier-cabinet');
  const board=get<SVGSVGElement>('.atelier-board'),operation=get<HTMLElement>('.atelier-operation');
  const stageHost=get<HTMLElement>('.atelier-stage'),primary=get<HTMLButtonElement>('[data-action=primary]');
  const listen=(target:EventTarget,name:string,handler:EventListenerOrEventListenerObject,options:AddEventListenerOptions={})=>target.addEventListener(name,handler,{...options,signal:abort.signal});
  let primaryHeld=false;
  const acceptsInput=()=>active&&!disposed&&!container.inert&&!help.isOpen;
  let viewport={width:1,height:1};
  let canvasSize={width:1,height:1};
  const needleAnchor=scene.scene.getObjectByName('atelier-needle');
  const needlePosition=new THREE.Vector3();
  const needleGauge=get<HTMLElement>('.atelier-needle-gauge');

  function toast(message:string,duration=4200){ get<HTMLElement>('.atelier-toast').textContent=message;get<HTMLElement>('.atelier-toast').hidden=false;toastUntil=performance.now()+duration; }
  function save(){
    if(!dirty)return;
    const success=storage?saveTailoringState(storage,storageKey,state):false;
    get('[data-save-status]').textContent=success?t`制作进度已保存 · 衣柜保存在此浏览器`:t`浏览器未能保存，请保持当前页面打开`;
    dirty=false;lastSave=performance.now();
  }
  function setState(next:TailoringState,full=true){
    if(next===state)return;
    if(full)releaseAll();
    const oldPiece=getRunView(state).pieceIndex,oldSeam=getRunView(state).seamIndex;
    state=next;visibleStage=next.stage;dirty=true;
    if(oldPiece!==getRunView(state).pieceIndex){pointer=null;keyboardCursor={...getRunView(state).cuttingPoint};toast(t`下一片：${getRunView(state).piece.label}`,1700);}
    if(oldSeam!==getRunView(state).seamIndex){pedalHeld=false;keys.delete('Space');toast(t`完成一道缝线。下一道：${getRunView(state).seamLabel}`,2100);}
    if(full){renderPanel();syncStage();save();} else syncBoard();
  }
  function selectedItem():CraftedGarment|undefined {return state.inventory.find(item=>item.id===selectedId);}
  function renderDesign(){
    const design=state.design,fabric=getFabric(design.fabric),suitability=materialSuitability(design);
    return `<section class="atelier-section"><div class="atelier-section-title"><h2>${t`选一款版型`}</h2><span>${t`基础系列 / 3 款`}</span></div><div class="atelier-patterns">${PATTERNS.map((p,i)=>`<button type="button" class="atelier-pattern" data-kind="${p.id}" aria-pressed="${design.kind===p.id}" title="${p.description}">${garmentIcon(p.id)}<b>${p.label}</b><small>Pattern ${String(i+1).padStart(2,'0')}</small></button>`).join('')}</div><div class="atelier-fits" role="group" aria-label="${t`版型松量`}">${FITS.map(f=>`<button type="button" data-fit="${f.id}" aria-pressed="${design.fit===f.id}" title="${f.description}">${f.name}</button>`).join('')}</div><p class="atelier-pattern-note">${getPattern(design.kind).description}</p></section>
      <section class="atelier-section"><div class="atelier-section-title"><h2>${t`摸摸这块布`}</h2><span>${t`真实织物纹理`}</span></div><div class="atelier-fabrics">${FABRICS.map(f=>`<button type="button" class="atelier-fabric" data-fabric="${f.id}" aria-pressed="${design.fabric===f.id}"><span class="atelier-swatch" style="--dye:${f.color};background-image:url('${textileUrl(f.id,'color')}')"></span><b>${f.label}</b><small>${f.weightGsm} g/m² · ${f.stretch>.4?t`柔软弹性`:f.drape>.8?t`轻盈垂坠`:t`自然挺括`}</small></button>`).join('')}</div><p class="atelier-material-note">${fabric.description}</p><div class="atelier-material-traits"><span>${t`弹性`}<i style="--amount:${pct(fabric.stretch)}"></i></span><span>${t`垂感`}<i style="--amount:${pct(fabric.drape)}"></i></span><span>${t`稳定`}<i style="--amount:${pct(fabric.stability)}"></i></span></div><div class="atelier-suitability ${suitability<75?'is-tricky':''}">${suitability>=90?t`很适合这个版型`:suitability>=75?t`适合尝试不同的质感`:t`有挑战的搭配，成衣结构分会降低`} · ${t`配布 ${suitability} 分`}</div></section>
      <section class="atelier-section"><div class="atelier-section-title"><h2>${t`布色与线色`}</h2><span>${DYES.find(d=>d.color===design.color)?.name??t`自选染色`}</span></div><div class="atelier-colors" role="group" aria-label="${t`布料颜色`}">${DYES.map(d=>`<button type="button" class="atelier-color" data-dye="${d.color}" style="--swatch:${d.color}" aria-label="${d.name}" title="${d.name}" aria-pressed="${d.color===design.color}"></button>`).join('')}<label class="atelier-custom" title="${t`自选布料颜色`}"><input type="color" data-custom-dye aria-label="${t`自选布料颜色`}" value="${design.color}"></label></div><div class="atelier-thread"><span>${t`缝线`}</span>${THREADS.map(thread=>`<button type="button" data-thread="${thread.color}" style="--swatch:${thread.color}" title="${t`${thread.name}缝线`}" aria-label="${t`${thread.name}缝线`}" aria-pressed="${thread.color===design.threadColor}"></button>`).join('')}</div></section>
      ${progressPanel()}`;
  }
  function progressPanel(){const level=levelProgress(state.xp);return `<hr class="atelier-divider"><div class="atelier-section-title"><h2>${t`制衣手记`}</h2><span>Lv.${level.level}</span></div><div class="atelier-meter"><span style="width:${pct(level.progress)}"></span></div><p>${level.current} / ${level.needed} XP · ${state.inventory.length} garments</p>`;}
  function renderWork(){
    const view=getRunView(state),fabric=getFabric(state.design.fabric),cut=visibleStage==='cut';
    return `<section class="atelier-section"><div class="atelier-section-title"><h2>${cut?t`裁剪台`:t`缝纫机`}</h2><span>${getPattern(state.design.kind).label} / ${fabric.label}</span></div><div class="atelier-pieces">${getPatternPieces(state.design).map((p,i)=>`<span class="${i<state.run!.cut.pieceIndex?'is-done':i===view.pieceIndex?'is-current':''}">${p.label}</span>`).join('')}</div></section>
      <div class="atelier-metrics"><div class="atelier-metric"><small>${cut?t`当前裁片`:t`当前缝线`}</small><strong data-hud="progress">0<span>%</span></strong><div class="atelier-meter"><span data-hud-bar="progress"></span></div></div><div class="atelier-metric"><small>${cut?t`裁剪精度`:t`针脚精度`}</small><strong data-hud="precision">100<span>%</span></strong><div class="atelier-meter"><span data-hud-bar="precision"></span></div></div><div class="atelier-metric"><small>${t`整件进度`}</small><strong data-hud="total">0<span>%</span></strong></div><div class="atelier-metric"><small>${cut?t`已裁片数`:t`已完成缝线`}</small><strong data-hud="count">0<span>/ ${cut?view.pieceCount:view.seamCount}</span></strong></div></div>
      ${cut?`<p class="atelier-guide">${scissorsIcon.replace('<svg','<svg style="width:32px;height:32px;stroke:#7f946e;stroke-width:2;margin-bottom:12px"')}${t`从金色圆点落剪，按住鼠标或手指，沿虚线慢慢裁一圈。`}<br>${t`剪偏会降低精度，可重新裁当前片。`}<br><br>${t`${`<kbd>${t`方向键`}</kbd>`} 移动剪刀，按住 ${`<kbd>${t`空格`}</kbd>`} 落剪。`}<br>${t`所有裁片完成后，就可以开始缝制。`}</p>`:
      `<div class="atelier-section-title"><h2>${t`线张力`}</h2><span>${t`${fabric.label}适宜 ${Math.round(fabric.idealTension*100)}`}</span></div><input type="range" data-tension min="0" max="100" value="${Math.round(threadTension*100)}" aria-label="${t`缝线张力`}" style="width:100%;accent-color:#718d63"><div class="atelier-tension-track"><i data-hud-tension></i></div><div class="atelier-tension-note"><span>${t`松`}</span><span>${t`紧`}</span></div><label class="atelier-speed">${t`送布速度`}<input type="range" data-speed min="18" max="100" value="${Math.round(pedalSpeed*100)}" aria-label="${t`送布速度`}"></label><button class="atelier-pedal" type="button" data-pedal>${needleIcon}<span><b>${t`按住踩踏板`}</b><small>${t`空格 / 鼠标 / 触摸`}</small></span></button><div class="atelier-steering"><button type="button" data-steer="-1" aria-label="${t`向左扶布`}">◀</button><span>${t`轻扶布料，修正偏移`}</span><button type="button" data-steer="1" aria-label="${t`向右扶布`}">▶</button></div><p class="atelier-guide">${t`按住 ${`<kbd>${t`空格`}</kbd>`} 送布，${'<kbd>←</kbd> <kbd>→</kbd>'} 沿布边轻扶，保持针尖落在浅色缝线带内。`}<br>${t`松开踏板会暂停。缝完一道后，松开再踩继续。`}${fabric.id==='satin'?`<br>${t`缎面易滑，建议把速度调到 38% 左右。`}`:''}</p>`}
      <hr class="atelier-divider"><p class="atelier-material-note">${fabric.description}</p><button type="button" class="atelier-retry" data-action="restart">${t`放下这件，重新选版`}</button>`;
  }
  function renderResult(){
    const result=visibleStage==='finish'&&state.run?evaluateRun(state.run):undefined;
    const item=selectedItem();
    const descriptor=visibleStage==='finish'?state.design:item?.descriptor;
    if(!descriptor)return `<div class="atelier-empty">${hangerIcon}${t`衣柜还是空的。`}<br>${t`选布、裁剪、缝上第一道线，`}<br>${t`把第一件成衣挂在这里。`}</div>${progressPanel()}`;
    const quality=result?.quality??item!.descriptor.quality;
    const grade=td(result?.grade??item!.grade);
    return `<div class="garment-sample" style="color:${descriptor.color}">${garmentIcon(descriptor.kind)}</div><div class="atelier-grade"><strong>${Math.round(quality)}</strong><small>${grade.split(' · ')[1]??grade}</small></div><h2 class="atelier-result-name">${getPattern(descriptor.kind).name}</h2><p class="atelier-result-description">${getFabric(descriptor.fabric).name} · ${FITS.find(f=>f.id===descriptor.fit)?.name}<br>${visibleStage==='finish'?t`最后一道针脚，完成了。`:'Saved garment'}</p>
      <ul class="atelier-quality-list"><li>${t`裁片精度`}<b>${result?.cutScore??item!.cutScore}</b></li><li>${t`针脚品质`}<b>${result?.sewScore??item!.sewScore}</b></li><li>${t`布料适配`}<b>${result?.materialScore??item!.materialScore}</b></li><li>${t`手艺经验`}<b>+${result?.xp??item!.xp}</b></li></ul>
      ${visibleStage==='wardrobe'?`<hr class="atelier-divider"><div class="atelier-section-title"><h2>${t`我的作品`}</h2><span>${state.inventory.length} / 48</span></div><div class="atelier-inventory">${state.inventory.map(g=>`<button type="button" class="atelier-garment" data-item="${escape(g.id)}" style="--garment-color:${g.descriptor.color}" aria-pressed="${g.id===selectedId}">${garmentIcon(g.descriptor.kind)}<span><strong>${escape(td(g.name))}</strong><small>${t`${Math.round(g.descriptor.quality)} 分`} · ${escape(td(g.grade))}</small></span></button>`).join('')}</div>`:''}${progressPanel()}`;
  }
  function renderPanel(){
    const scroll=cabinet.scrollTop;
    cabinet.innerHTML=visibleStage==='design'?renderDesign():visibleStage==='cut'||visibleStage==='sew'?renderWork():renderResult();
    cabinet.scrollTop=scroll;
    get('[data-inventory-count]').textContent=String(state.inventory.length);
    const stageNumber={design:0,cut:1,sew:2,finish:3,wardrobe:3}[visibleStage];
    container.querySelectorAll<HTMLElement>('[data-step]').forEach((step,i)=>{step.classList.toggle('is-current',i===stageNumber);step.classList.toggle('is-done',i<stageNumber);if(i===stageNumber)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');});
    const view=getRunView(state);
    primary.disabled=visibleStage==='cut'&&!view.cutsComplete;
    const primaryInfo=visibleStage==='design'?`${scissorsIcon}${t`开始裁剪`}`:visibleStage==='cut'?`${needleIcon}${t`送去缝纫`}`:visibleStage==='sew'?`${needleIcon}${t`缝制中 ${Math.round(view.totalSewProgress*100)}%`}`:visibleStage==='finish'?`${hangerIcon}${t`收入衣柜`}`:`${scissorsIcon}${state.run?t`继续制作`:t`再做一件`}`;
    primary.innerHTML=primaryInfo;
    if(visibleStage==='sew')primary.disabled=true;
    get('[data-action-hint]').textContent=visibleStage==='design'?t`${getPatternPieces(state.design).length} 片裁片 · 慢慢来，手感最重要`:visibleStage==='cut'?(view.cutsComplete?t`所有裁片已完成`:t`完成全部裁片后继续`):visibleStage==='finish'?qualityGrade(view.quality):'';
    const wardrobeButton=get<HTMLButtonElement>('[data-action=wardrobe]');
    wardrobeButton.disabled=visibleStage==='finish';
    updateHud();
  }
  function syncStage(){
    const creating=visibleStage==='cut'||visibleStage==='sew',fitting=visibleStage==='finish'||visibleStage==='wardrobe';
    operation.hidden=!creating;
    stageHost.classList.toggle('is-making',creating);stageHost.dataset.stage=visibleStage;
    const titles={design:[t`从一块好布开始`,t`从布料，到衣橱。`,t`选布、选版，再亲手完成每一道工序。`],cut:[t`剪裁 / 顺着布纹`,t`让轮廓，慢慢成形。`,t`从金色圆点开始，按住并沿轮廓裁剪。`],sew:[t`缝制 / 留下针脚`,t`一针一线，都算数。`,t`轻踩踏板，扶稳布料，把针尖留在缝线里。`],finish:['Finished garment','Finished seams','Review the cut, stitching and material scores.'],wardrobe:['Wardrobe','Finished garments','Select a garment to see its design and construction scores.']};
    const title=titles[visibleStage];get('[data-stage-kicker]').textContent=title[0];get('[data-stage-title]').textContent=title[1];get('[data-stage-description]').textContent=title[2];
    const cloth=visibleStage==='wardrobe'?selectedItem()?.descriptor:state.design;scene.setStage(fitting?'design':visibleStage);if(cloth)scene.setFabric(cloth.fabric,cloth.color,cloth.threadColor);
    boardKey='';syncBoard();
    if(visibleStage==='wardrobe'&&!selectedItem())selectedId=state.inventory[0]?.id??null;
    frame();
  }
  function syncBoard(){
    if(visibleStage!=='cut'&&visibleStage!=='sew')return;
    const view=getRunView(state),cut=visibleStage==='cut';
    const signature=`${visibleStage}:${view.pieceIndex}:${view.seamIndex}`;
    if(boardKey!==signature){
      boardKey=signature;pointer=null;keyboardCursor={...view.cuttingPoint};
      board.style.setProperty('--cloth-color',state.design.color);board.style.setProperty('--thread-color',state.design.threadColor);board.style.backgroundImage=`url('${textileUrl(state.design.fabric,'color')}')`;
      board.setAttribute('aria-label',cut?t`裁剪${view.piece.label}，从起点沿轮廓拖动`:t`缝制${view.seamLabel}，按住空格并左右扶布`);
      board.innerHTML=cut?`<path class="pattern-paper" d="${pathD(view.piece.outline)}Z"/><path class="pattern-grain" d="M50 36V70m-2-3 2 3 2-3"/><text x="50" y="53" text-anchor="middle" font-size="3" fill="#8b967b" font-family="serif">${view.piece.label}</text><path class="pattern-outline" d="${pathD(view.piece.outline)}"/><path class="pattern-cut"/><circle class="pattern-start" cx="${view.piece.outline[0].x*100}" cy="${view.piece.outline[0].y*100}" r="2.2"/><circle class="pattern-cursor" r="1.1"/>`:
      `<path class="pattern-grain" d="${pathD(view.piece.outline)}Z" fill="none"/><path class="seam-target" d="${pathD(view.seam)}"/><path class="seam-guide" d="${pathD(view.seam)}"/><path class="seam-stitched"/><g class="sewing-needle"><ellipse class="needle-shadow" cx="1" cy="1" rx="3" ry="2"/><path class="needle-cross" d="M-4 0H4M0-4V4"/><circle class="needle-eye" r="1"/></g>`;
      get('[data-operation-title]').textContent=cut?view.piece.label:view.seamLabel;
      get('[data-operation-count]').textContent=cut?t`${Math.min(state.run!.cut.pieceIndex+1,view.pieceCount)} / ${view.pieceCount} 片`:t`${Math.min(state.run!.sew.seamIndex+1,view.seamCount)} / ${view.seamCount} 道`;
      get('[data-operation-hint]').textContent=cut?t`沿纸样外侧虚线裁剪 · 松手暂停`:t`浅色带是缝线目标 · 松开踏板暂停`;
      get('[data-action=redo]').textContent=cut?t`重新裁这一片`:t`拆掉这一道，重新缝`;
    }
    if(cut){
      board.querySelector('.pattern-cut')!.setAttribute('d',pathD(state.run!.cut.trace));
      const cursor=board.querySelector('.pattern-cursor')!;cursor.setAttribute('cx',String(keyboardCursor.x*100));cursor.setAttribute('cy',String(keyboardCursor.y*100));
      get('[data-board-hint]').textContent=view.cutsComplete?t`裁片已齐，可以缝制了`:!state.run!.cut.started?t`从金色圆点落剪`:'';
    } else {
      board.querySelector('.seam-stitched')!.setAttribute('d',pathD(state.run!.sew.trace));
      board.querySelector('.sewing-needle')!.setAttribute('transform',`translate(${view.needlePoint.x*100} ${view.needlePoint.y*100})`);
      get('[data-board-hint]').textContent=Math.abs(view.offset)>getFabric(state.design.fabric).sewingTolerance?t`偏离缝线了，轻扶布料修正`:'';
    }
    get<HTMLElement>('[data-operation-progress]').style.width=pct(cut?view.totalCutProgress:view.totalSewProgress);
  }
  function updateHud(){
    if(visibleStage!=='cut'&&visibleStage!=='sew')return;
    const view=getRunView(state),cut=visibleStage==='cut';
    const values={progress:(cut?view.cutProgress:view.sewProgress)*100,precision:cut?view.cutPrecision:view.sewPrecision,total:(cut?view.totalCutProgress:view.totalSewProgress)*100,count:cut?state.run!.cut.pieceIndex:state.run!.sew.seamIndex};
    for(const [name,value]of Object.entries(values)){
      const target=container.querySelector<HTMLElement>(`[data-hud=${name}]`);if(target)target.innerHTML=`${Math.round(value)}<span>${name==='count'?`/ ${cut?view.pieceCount:view.seamCount}`:'%'}</span>`;
      const bar=container.querySelector<HTMLElement>(`[data-hud-bar=${name}]`);if(bar)bar.style.width=`${value}%`;
    }
    const tension=get<HTMLElement>('[data-hud-tension]');if(tension)tension.style.left=pct(threadTension);
    const pedal=container.querySelector('[data-pedal]');pedal?.classList.toggle('is-held',pedalHeld||keys.has('Space'));
    if(visibleStage==='sew')primary.innerHTML=`${needleIcon}${t`缝制中 ${Math.round(view.totalSewProgress*100)}%`}`;
    if(visibleStage==='cut'){
      primary.disabled=!view.cutsComplete;
      get('[data-action-hint]').textContent=view.cutsComplete?t`所有裁片已完成`:t`完成全部裁片后继续`;
    }
  }
  function toPoint(event:PointerEvent):Point|null{
    const matrix=board.getScreenCTM();if(!matrix)return null;
    const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    return {x:p.x/100,y:p.y/100};
  }
  function inputClick(event:Event){
    if(!acceptsInput())return;
    audio.unlock();
    const target=(event.target as Element).closest<HTMLElement>('button');if(!target)return;
    if(target.dataset.kind){setState(configureDesign(state,{kind:target.dataset.kind as TailoringDesign['kind']}));return;}
    if(target.dataset.fit){setState(configureDesign(state,{fit:target.dataset.fit as TailoringDesign['fit']}));return;}
    if(target.dataset.fabric){const fabric=getFabric(target.dataset.fabric as TailoringDesign['fabric']);threadTension=fabric.idealTension;pedalSpeed=fabric.idealPedal;setState(configureDesign(state,{fabric:fabric.id,color:fabric.color}));return;}
    if(target.dataset.dye){setState(configureDesign(state,{color:target.dataset.dye}));return;}
    if(target.dataset.thread){setState(configureDesign(state,{threadColor:target.dataset.thread}));return;}
    if(target.dataset.item){selectedId=target.dataset.item;renderPanel();syncStage();return;}
    switch(target.dataset.action){
      case'primary':
        if(visibleStage==='design'){threadTension=getFabric(state.design.fabric).idealTension;setState(startCutting(state));}
        else if(visibleStage==='cut')setState(startSewing(state));
        else if(visibleStage==='finish'){const next=finishGarment(state);selectedId=next.lastFinishedId;setState(next);toast('Saved to the wardrobe.');}
        else if(visibleStage==='wardrobe'){if(state.run){visibleStage=state.stage;renderPanel();syncStage();}else setState(startNewDesign(state));}
        break;
      case'redo':setState(visibleStage==='cut'?resetCurrentPiece(state):resetCurrentSeam(state));pedalHeld=false;keys.delete('Space');toast(visibleStage==='cut'?t`新布已铺好，从起点重新裁剪。`:t`已经拆线，这次慢一点。`);break;
      case'restart':setState(startNewDesign(state));break;
      case'wardrobe':
        releaseAll();
        if(visibleStage==='wardrobe'){if(state.run){visibleStage=state.stage;renderPanel();syncStage();}else setState(startNewDesign(state));}
        else {visibleStage='wardrobe';selectedId=state.inventory[0]?.id??null;if(!state.run)state=showWardrobe(state);renderPanel();syncStage();}
        break;
      case'sound':{const muted=audio.toggle();target.setAttribute('aria-pressed',String(!muted));target.textContent=muted?t`音效关`:t`音效开`;break;}
      case'leave':save();exit();break;
    }
  }
  listen(container,'click',inputClick);
  listen(container,'input',event=>{
    if(!acceptsInput())return;const target=event.target as HTMLInputElement;
    if(target.matches('[data-custom-dye]'))setState(configureDesign(state,{color:target.value}));
    if(target.matches('[data-speed]'))pedalSpeed=Number(target.value)/100;
    if(target.matches('[data-tension]'))threadTension=Number(target.value)/100;
  });
  listen(container,'change',event=>{
    if(!acceptsInput())return;const target=event.target as HTMLSelectElement;
  });
  listen(container,'pointerdown',event=>{
    if(!acceptsInput())return;audio.unlock();const e=event as PointerEvent,target=e.target as Element;
    const pedal=target.closest<HTMLElement>('[data-pedal]'),steer=target.closest<HTMLElement>('[data-steer]');
    if(pedal||steer){e.preventDefault();(pedal??steer)!.setPointerCapture(e.pointerId);if(pedal)pedalHeld=true;else steerHeld=Number(steer!.dataset.steer);return;}
    if(target.closest('.atelier-board')&&(visibleStage==='cut'||visibleStage==='sew')){
      e.preventDefault();board.focus({preventScroll:true});board.setPointerCapture(e.pointerId);const p=toPoint(e);if(p){pointer={id:e.pointerId,point:p};keyboardCursor={...p};if(visibleStage==='cut')setState(traceCut(state,p,.016),false);}return;
    }
  });
  listen(container,'pointermove',event=>{
    if(!acceptsInput())return;const e=event as PointerEvent;
    if(pointer?.id===e.pointerId){const p=toPoint(e);if(p){pointer.point=p;keyboardCursor={...p};}}
  });
  const releasePointer=(event:Event)=>{const e=event as PointerEvent;if(pointer?.id===e.pointerId)pointer=null;const target=e.target as Element;if(target.closest?.('[data-pedal]'))pedalHeld=false;if(target.closest?.('[data-steer]'))steerHeld=0;};
  listen(container,'pointerup',releasePointer);listen(container,'pointercancel',releasePointer);listen(container,'lostpointercapture',releasePointer);
  const releaseAll=()=>{audio.stop();keys.clear();primaryHeld=false;pedalHeld=false;steerHeld=0;pointer=null;};
  const help=createActivityPanel({onOpen(){releaseAll();save();},onClose(){lastFrame=performance.now();board.focus();}});
  const controls=createActivityControls({active:()=>active&&!disposed&&!container.inert,
    book:()=>help.open(t`制衣手册`,['Choose the fabric and pattern, cut each piece, then sew and finish.',t`裁剪保留沿线拖动；也可用方向键移动，按住 E 裁剪。缝纫按住 E 踩踏板，方向键修正。`,t`R 当前工序 · Esc 暂停。`]),
    task:()=>help.open(t`当前工序`,[get('[data-stage-title]').textContent??'',get('[data-operation-hint]').textContent??'',get('[data-action-hint]').textContent??'']),
    pause:()=>help.open(t`制作已暂停`,[t`当前裁片与缝线进度已保留。`],[{text:t`返回城市`,run(){exit();}}]),
    primaryDown(){if(!acceptsInput())return;audio.unlock();if(visibleStage==='cut'||visibleStage==='sew')primaryHeld=true;else primary.click();},primaryUp(){primaryHeld=false;},suspend:releaseAll});
  listen(window,'blur',()=>{releaseAll();save();});listen(document,'visibilitychange',()=>{if(document.hidden){releaseAll();save();}});
  listen(window,'pagehide',()=>save());
  listen(document,'keydown',event=>{
    if(!acceptsInput()||visibleStage==='wardrobe')return;const e=event as KeyboardEvent;
    audio.unlock();
    if((e.target as Element).matches('input,select,textarea,button')&&!(e.target as Element).closest('[data-pedal],[data-steer]'))return;
    if(['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)){if(visibleStage==='cut'||visibleStage==='sew'){e.preventDefault();if(!e.repeat)keys.add(e.code);}}
    if(e.code==='Escape'){releaseAll();save();}
  });
  listen(document,'keyup',event=>{keys.delete((event as KeyboardEvent).code);});

  function frame(){
    const rect=host.getBoundingClientRect();const width=Math.max(1,Math.round(rect.width||viewport.width)),height=Math.max(1,Math.round(rect.height||viewport.height));
    canvasSize={width,height};renderer.setSize(width,height,false);scene.resize(width,height);
    scene.camera.zoom=1;scene.camera.updateProjectionMatrix();
  }
  const resizeObserver=new ResizeObserver(()=>{if(!disposed&&active)frame();});resizeObserver.observe(host);
  function render(now:number){
    const dt=Math.min(.06,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
    if(!active||disposed)return;
    if(acceptsInput()&&visibleStage==='cut'&&!getRunView(state).cutsComplete){
      let contact=pointer?.point;
      const dx=Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft')),dy=Number(keys.has('ArrowDown'))-Number(keys.has('ArrowUp'));
      if(dx||dy){keyboardCursor={x:clamp(keyboardCursor.x+dx*dt*.3,0,1),y:clamp(keyboardCursor.y+dy*dt*.3,0,1)};syncBoard();}
      if(keys.has('Space')||primaryHeld)contact=keyboardCursor;
      if(contact){const before=state.run!.cut.distance;const next=traceCut(state,contact,Math.max(.008,dt));const oldIndex=state.run!.cut.pieceIndex;setState(next,false);if(state.run!.cut.distance>before||state.run!.cut.pieceIndex!==oldIndex)audio.snip(now);if(state.run!.cut.pieceIndex!==oldIndex){renderPanel();boardKey='';syncBoard();save();}}
    }
    if(acceptsInput()&&visibleStage==='sew'){
      const view=getRunView(state);let steer=steerHeld+Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft'));
      if(pointer){const next=pathPointAt(view.seam,Math.min(.999,view.sewProgress+.01)),prev=pathPointAt(view.seam,Math.max(0,view.sewProgress-.01));const dx=next.x-prev.x,dy=next.y-prev.y,len=Math.hypot(dx,dy)||1;steer=clamp(((pointer.point.x-view.needlePoint.x)*(-dy/len)+(pointer.point.y-view.needlePoint.y)*(dx/len))*16);}
      const previousSeam=state.run!.sew.seamIndex;
      const next=advanceSewing(state,{deltaSeconds:dt,pedal:pedalHeld||primaryHeld||keys.has('Space')?pedalSpeed:0,steer:clamp(steer),tension:threadTension});
      if(next.stage!==state.stage){releaseAll();setState(next);audio.complete();toast(t`所有缝线完成，看看你的第一件成衣。`);}
      else {setState(next,false);if(state.run!.sew.seamIndex!==previousSeam){renderPanel();boardKey='';syncBoard();save();}}
    }
    const soundingPedal=visibleStage==='sew'&&(pedalHeld||keys.has('Space'))?pedalSpeed:0;audio.update(now,soundingPedal);
    const view=getRunView(state);scene.update(now,{pedal:visibleStage==='sew'&&(pedalHeld||keys.has('Space'))?pedalSpeed:0,progress:view.sewProgress,offset:view.offset});
    renderer.render(scene.scene,scene.camera);
    needleGauge.hidden=visibleStage!=='sew';
    if(visibleStage==='sew'&&needleAnchor){
      needlePosition.set(0,-.155,0);needleAnchor.localToWorld(needlePosition);needlePosition.project(scene.camera);
      const x=(needlePosition.x*.5+.5)*canvasSize.width+32,y=(-needlePosition.y*.5+.5)*canvasSize.height-48;
      needleGauge.style.left=`${clamp(x,31,canvasSize.width-31)}px`;needleGauge.style.top=`${clamp(y,31,canvasSize.height-31)}px`;
      const precision=getRunView(state).sewPrecision;needleGauge.querySelector('strong')!.textContent=String(precision);
      needleGauge.querySelector('.needle-gauge-value')!.setAttribute('stroke-dasharray',`${precision} 100`);
      needleGauge.classList.toggle('is-deviating',Math.abs(view.offset)>getFabric(state.design.fabric).sewingTolerance);
    }
    if(now-lastHud>100){lastHud=now;updateHud();}
    if(dirty&&now-lastSave>1250)save();
    if(toastUntil&&now>toastUntil){get<HTMLElement>('.atelier-toast').hidden=true;toastUntil=0;}
  }
  function setQuality(quality:RenderQuality){
    scene.scene.traverse(object=>{if(object instanceof THREE.DirectionalLight&&object.castShadow){
      if(object.shadow.mapSize.x!==quality.shadowMapSize){object.shadow.map?.dispose();object.shadow.map=null;object.shadow.mapSize.setScalar(quality.shadowMapSize);}
    }});
  }
  function dispose(){if(disposed)return;save();disposed=true;active=false;controls.dispose();help.dispose();releaseAll();abort.abort();resizeObserver.disconnect();audio.dispose();scene.dispose();container.replaceChildren();}
  renderPanel();syncStage();
  void scene.ready.catch(()=>{if(!disposed)toast('Some fabric textures could not load.');});
  return {activate(){active=true;lastFrame=performance.now();host.append(renderer.domElement);frame();},deactivate(){active=false;controls.suspend();help.close(false);save();},render,resize(width,height){viewport={width,height};frame();},setQuality,dispose};
}
