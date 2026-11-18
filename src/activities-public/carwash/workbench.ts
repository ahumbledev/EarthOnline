import { WashScene } from './scene.ts';
import { generateDirt } from './dirt.ts';
import { countBits } from './gpu.ts';
import {
  NOZZLE_ORDER, PART_THRESHOLDS, PRACTICE_RECIPE, cleanWeight, countDirty,
  partProgress, totalProgress, type NozzleId,
} from './rules.ts';
import './workbench.css';

export function mountWashBay(root:HTMLElement, exit:()=>void){
  const panel=document.createElement('section');
  panel.className='practice-wash-bay';
  panel.innerHTML=`<canvas tabindex="0" aria-label="Aim at the car and hold to wash"></canvas>
    <div class="wash-toolbar">
      <h2>Wash bay</h2><button data-exit>Workshops</button>
      <label>Vehicle <select data-vehicle><option value="hatch">Hatchback</option><option value="sedan">Sedan</option><option value="van">Van</option></select></label>
      <label>Nozzle <select data-nozzle></select></label>
      <button data-side>Walk around</button><button data-raise aria-pressed="false">Raise viewpoint</button>
      <button data-rotate aria-pressed="false">Rotate fan</button>
    </div><div class="wash-readout"><output role="status">Loading workshop…</output><progress max="1" value="0" aria-label="Vehicle cleanliness"></progress>
    <small>Hold and sweep to wash. Use WASD to walk, right-drag to look, or choose Walk around.</small></div>`;
  root.append(panel);
  const canvas=panel.querySelector('canvas')!;
  const status=panel.querySelector('output')!;
  const meter=panel.querySelector('progress')!;
  const picks=panel.querySelector<HTMLSelectElement>('[data-vehicle]')!;
  const nozzles=panel.querySelector<HTMLSelectElement>('[data-nozzle]')!;
  const view=new WashScene(canvas);
  const inputs=new AbortController();
  const observer=new ResizeObserver(()=>view.resize());
  observer.observe(canvas);
  const keys=new Set<string>();
  let live=true,held=false,looking=false,rotated=false,raised=false,side=0;
  let active=false,reading=false,needsCount=false,prior=0,lastRead=0,nozzle:NozzleId='fan';
  let x=0,y=0,starts=new Uint32Array(),completed=new Set<number>(),cleanliness=0;
  let sweep:{x:number;y:number}[]=[];
  for(const id of NOZZLE_ORDER)nozzles.add(new Option(id.charAt(0).toUpperCase()+id.slice(1),id));
  function chooseSide(){
    const car=view.vehicle;
    if(!car)return;
    const [width,height,length]=car.meta.dimensions;
    const sides=[[width/2+.95,length/2+.95],[width/2+1,0],[0,-length/2-1.15],[-width/2-1,0],[0,length/2+1.15]];
    const [px,pz]=sides[side];
    view.camera.position.set(px,raised?2.4:1.65,pz);
    const radius=Math.hypot(px,pz);
    view.yaw=Math.atan2(px,pz);
    view.pitch=Math.atan2(height*.47-view.camera.position.y,radius);
    x=0;y=0;sweep=[];
  }
  async function selectVehicle(){
    active=false;held=false;picks.disabled=true;meter.value=0;cleanliness=0;status.textContent='Loading surfaces…';
    try{
      const vehicle=await view.setVehicle(picks.value);
      if(!live)return;
      const meta=vehicle.meta;
      const initial=generateDirt({size:meta.washMap,position:vehicle.baked.position,normal:vehicle.baked.normal,
        partOf:vehicle.partOf,kinds:meta.parts.map(p=>p.kind),access:vehicle.access,accessSize:meta.accessMap,
        dimensions:meta.dimensions,wheels:meta.wheels},PRACTICE_RECIPE,Math.floor(Math.random()*0x7fffffff));
      starts=new Uint32Array(countDirty(initial,vehicle.partOf,meta.parts.length));
      completed=new Set();needsCount=false;view.gpu!.load(initial);view.setLance('extension');view.setNozzle(nozzle);
      side=0;chooseSide();active=true;status.textContent='Ready to wash';
    }catch(error){if(live)status.textContent=error instanceof Error?error.message:'Unable to load the wash bay.';}
    finally{if(live)picks.disabled=false;}
  }
  async function updateProgress(){
    const vehicle=view.vehicle,gpu=view.gpu;
    if(!vehicle||!gpu||reading)return;
    reading=true;needsCount=false;
    try{
      const bits=await gpu.dirtyBits();
      if(!live||!active||vehicle!==view.vehicle||!bits)return;
      const parts=vehicle.meta.parts;
      const counts=countBits(bits,vehicle.partOf,vehicle.meta.washMap,parts.length);
      const scores=parts.map((part,i)=>{
        const threshold=PART_THRESHOLDS[part.kind].threshold;
        const progress=partProgress(starts[i],counts[i],threshold);
        if(progress===1&&!completed.has(i)){completed.add(i);if(starts[i])gpu.clearPart(i);}
        return {progress,weight:cleanWeight(starts[i],threshold)};
      });
      cleanliness=totalProgress(scores);meter.value=cleanliness;
    }catch(error){if(live)status.textContent=error instanceof Error?error.message:'Unable to read the wash map.';}
    finally{reading=false;}
  }
  function point(event:PointerEvent){
    const box=canvas.getBoundingClientRect();
    x=((event.clientX-box.left)/box.width)*2-1;y=1-((event.clientY-box.top)/box.height)*2;
    if(held){sweep.push({x,y});if(sweep.length>8)sweep.shift();}
  }
  canvas.oncontextmenu=(event)=>event.preventDefault();
  canvas.onpointerdown=(event)=>{
    if(!active||!event.isPrimary)return;
    canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);
    looking=event.button===2;held=event.button===0;point(event);
  };
  canvas.onpointermove=(event)=>{
    if(looking){view.yaw-=event.movementX*.004;view.pitch=Math.max(-1.3,Math.min(1.3,view.pitch-event.movementY*.004));}
    point(event);
  };
  canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=()=>{held=false;looking=false;};
  const clear=()=>{keys.clear();held=false;looking=false;};
  window.addEventListener('blur',clear,{signal:inputs.signal});
  document.addEventListener('visibilitychange',clear,{signal:inputs.signal});
  window.addEventListener('keydown',(event)=>{
    if(!active||event.repeat||!['KeyW','KeyA','KeyS','KeyD','KeyC','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code))return;
    if(event.target instanceof HTMLElement&&event.target.matches('button,select,input'))return;
    event.preventDefault();keys.add(event.code);
  },{signal:inputs.signal});
  window.addEventListener('keyup',(event)=>keys.delete(event.code),{signal:inputs.signal});
  panel.querySelector<HTMLButtonElement>('[data-exit]')!.onclick=exit;
  panel.querySelector<HTMLButtonElement>('[data-side]')!.onclick=()=>{side=(side+1)%5;chooseSide();canvas.focus();};
  const raise=panel.querySelector<HTMLButtonElement>('[data-raise]')!;
  raise.onclick=()=>{raised=!raised;raise.setAttribute('aria-pressed',String(raised));view.onStep=raised;chooseSide();canvas.focus();};
  const rotate=panel.querySelector<HTMLButtonElement>('[data-rotate]')!;
  rotate.onclick=()=>{rotated=!rotated;rotate.setAttribute('aria-pressed',String(rotated));canvas.focus();};
  picks.onchange=()=>{void selectVehicle();};
  nozzles.onchange=()=>{nozzle=nozzles.value as NozzleId;view.setNozzle(nozzle);canvas.focus();};
  view.renderer.setAnimationLoop((now)=>{
    if(!live||!active)return;
    const dt=Math.min(.05,Math.max(0,(now-prior)/1000));prior=now;
    view.move(keys,dt);
    const aim=view.aim(x,y),tip=view.aimGun(aim.point,dt);
    if(held&&aim.onCar&&dt){
      const samples=sweep.length?sweep:[{x,y}];
      const axes=samples.map(p=>view.aim(p.x,p.y).point.sub(tip).normalize());
      view.gpu!.wash({origin:tip,axes,nozzle:view.nozzleSettings(nozzle,'pro'),rotated,dt,time:view.clock+dt});
      needsCount=true;
    }
    sweep=[];view.water(tip,held?aim.point:null,nozzle,rotated,'pro',dt);view.frame(dt);
    if(needsCount&&!reading&&now-lastRead>400){lastRead=now;void updateProgress();}
    const part=view.vehicle!.meta.parts[aim.owner]?.name;
    status.textContent=cleanliness>=1?'Clean · all parts finished':Math.floor(cleanliness*1000)/10+'% clean'+(part?' · '+part:'');
  });
  void selectVehicle();
  return ()=>{live=false;clear();observer.disconnect();inputs.abort();view.dispose();panel.remove();};
}
