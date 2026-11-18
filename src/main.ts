import * as THREE from 'three';
import { cities, loadCity } from './maps/index.ts';
import { openDistrict } from './city/play.ts';
import { createWorldCamera } from './photography/camera.ts';
import './style.css';

const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const host=el('scene'),citySelect=el<HTMLSelectElement>('city'),status=el('status'),overlay=el('overlay');
const cityNames:Record<string,string>={'hong-kong':'香港',tokyo:'东京',philadelphia:'费城',montreal:'蒙特利尔',melbourne:'墨尔本',helsinki:'赫尔辛基'};
for(const c of cities)citySelect.add(new Option(cityNames[c.id]??c.name,c.id));
let active:Awaited<ReturnType<typeof openDistrict>>|undefined,cityId='',generation=0,timer=0,last=performance.now(),jump=false;
let character:'male'|'female'='male';
let closeActivity:(()=>void)|undefined, panelGeneration=0;
const keys=new Set<string>(),metric=el('metric'),hint=el('hint');
function say(message:string,sticky=false){clearTimeout(timer);status.textContent=message;if(!sticky)timer=window.setTimeout(()=>{status.textContent='';},3200);}
const setText=(o:HTMLElement,t:string)=>{if(o.textContent!==t)o.textContent=t;};
function refresh(){
  const mode=active?.mode;el('overview').setAttribute('aria-pressed',String(mode==='overview'));el('walk').setAttribute('aria-pressed',String(mode==='walk'));
  setText(el('time'),active?.night?'日景':'夜景');setText(el('ride'),active?.driving?'下车':'开车');
  el('peers').setAttribute('aria-pressed',String(!!active?.enabled));setText(el('peers'),active?.connected?'已联机':active?.enabled?'连接中':'联机');
  setText(hint,active?.driving?'W / S 加减速 · A / D 转向 · 空格手刹':mode==='walk'?'WASD 移动 · Shift 奔跑 · 空格跳跃 · 拖动环顾':'拖动旋转 · 滚轮缩放 · WASD 平移');
}
async function switchCity(renderer:THREE.WebGLRenderer,id:string){
  const token=++generation;keys.clear();jump=false;say('载入街区中…',true);
  try{
    const data=await loadCity(id);if(token!==generation)return;
    const next=await openDistrict(data,renderer,say,character);
    if(token!==generation){next.dispose();return;}
    active?.dispose();active=next;cityId=id;
    el('district').textContent=data.name;el('area').textContent=data.area;
    const credit=document.querySelector<HTMLAnchorElement>('footer a')!;credit.textContent=data.attribution+' ↗';credit.href='/maps/credits.html#'+encodeURIComponent(id);
    const url=new URL(location.href);url.searchParams.set('city',id);history.replaceState(null,'',url);
    refresh();say('');
  }catch(error){if(token===generation){if(cityId)citySelect.value=cityId;say('无法载入街区，请重新选择或刷新。 '+String(error),true);console.error(error);}}
}
function dismiss(){
  ++panelGeneration;const cleanup=closeActivity;closeActivity=undefined;cleanup?.();overlay.replaceChildren();overlay.hidden=true;el('app').inert=false;
  keys.clear();jump=false;last=performance.now();host.focus();
}
async function show(kind:'workshop'|'challenges'|'room'){
  if(!overlay.hidden)return;
  const token=++panelGeneration;overlay.hidden=false;el('app').inert=true;keys.clear();jump=false;
  try{
    if(kind==='workshop'){
      const {mountActivities}=await import('./activities-public/index.ts');
      if(token===panelGeneration)closeActivity=mountActivities(overlay,dismiss);
    }else if(kind==='room'){
      const {mountRoomEditor}=await import('./home/editor.ts');
      if(token!==panelGeneration)return;
      const back=document.createElement('button');
      back.textContent='← 返回城市';back.className='room-back';back.onclick=dismiss;
      const room=document.createElement('div');room.className='room-stage';overlay.replaceChildren(room,back);
      closeActivity=mountRoomEditor(room);
    }else{
      const {mountChallenges}=await import('./minigames/play.ts');
      if(token===panelGeneration)closeActivity=mountChallenges(overlay,dismiss);
    }
  }catch(e){dismiss();say('无法打开活动：'+String(e));}
}
function start(){
  const renderer=new THREE.WebGLRenderer({alpha:false,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.outputColorSpace=THREE.SRGBColorSpace;
  host.append(renderer.domElement);host.tabIndex=-1;
  new ResizeObserver(()=>renderer.setSize(host.clientWidth,host.clientHeight,false)).observe(host);
  const photo=createWorldCamera({
    canvas:renderer.domElement,host:el('viewport'),button:el<HTMLButtonElement>('photo'),
    active:()=>overlay.hidden === true,ready:()=>Boolean(active),changed:()=>{},opened:()=>{keys.clear();jump=false;},
    notify:say,previewChanged:framing=>el('app').classList.toggle('framing',framing)
  });
  const initial=new URL(location.href).searchParams.get('city');
  citySelect.value=cities.some(c=>c.id===initial)?initial!:'hong-kong';
  citySelect.onchange=()=>void switchCity(renderer,citySelect.value);
  el('overview').onclick=()=>{active?.view('overview');refresh();};
  el('walk').onclick=()=>{active?.view('walk');refresh();};el('ride').onclick=()=>{active?.drive();refresh();};
  el('home').onclick=()=>active?.reset();el('time').onclick=()=>{active?.time();refresh();};
  el('appearance').onclick=()=>{character=character==='male'?'female':'male';void switchCity(renderer,citySelect.value);};
  el('peers').onclick=()=>{active?.togglePeers();refresh();};el('activities').onclick=()=>void show('workshop');el('arcade').onclick=()=>void show('challenges');el('room').onclick=()=>void show('room');
  let drag:{id:number,x:number,y:number}|undefined;
  host.onpointerdown=e=>{if(drag)return;host.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY};host.focus();};
  host.onpointermove=e=>{if(drag?.id===e.pointerId){active?.rotate(e.clientX-drag.x,e.clientY-drag.y);drag.x=e.clientX;drag.y=e.clientY;}};
  host.onlostpointercapture=()=>{drag=undefined;};
  host.addEventListener('wheel',e=>{e.preventDefault();active?.zoom(e.deltaY);},{passive:false});
  const movements=new Set(['KeyW','KeyS','KeyA','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight']);
  window.addEventListener('keydown',e=>{if(!overlay.hidden||photo.isOpen||e.target instanceof HTMLSelectElement||e.metaKey||e.ctrlKey||e.altKey)return;
    if(movements.has(e.code)&&!(e.code==='Space'&&e.target instanceof HTMLButtonElement)){e.preventDefault();keys.add(e.code);if(e.code==='Space'&&!e.repeat)jump=true;}
    if(e.code==='KeyF'&&!e.repeat){active?.drive();refresh();}
  });
  window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();jump=false;});
  for(const b of document.querySelectorAll<HTMLButtonElement>('[data-key]')){
    b.onpointerdown=e=>{b.setPointerCapture(e.pointerId);keys.add(b.dataset.key!);if(b.dataset.key==='Space')jump=true;};
    b.onlostpointercapture=()=>keys.delete(b.dataset.key!);
  }
  let nextText=0;
  renderer.setAnimationLoop(now=>{
    const dt=Math.min(.065,Math.max(0,(now-last)/1000));last=now;
    if(active&&overlay.hidden){
      active.render(dt,keys,jump);jump=false;photo.afterRender();
      if(now>=nextText){
        const p=active.position;setText(metric,active.driving?`${active.speed} km/h`:`X ${Math.round(p.x)} m   /   Z ${Math.round(p.z)} m`);refresh();nextText=now+200;
      }
    }
  });
  void switchCity(renderer,citySelect.value);
}
try{start();}catch(e){say('需要支持 WebGL 2 的浏览器。 '+String(e),true);}
