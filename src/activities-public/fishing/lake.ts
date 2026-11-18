import { CAST_DURATION, createFishingSession, type FishingBait, type FishingDepth } from './gameplay.ts';
import { getFishSpecies } from './fish-catalog.ts';
import { createFightHud } from './fight-hud.ts';
import { floatMotion } from './float-motion.ts';
import { FISHING_ZONES, fishingZoneAt, lakeDistance, shorePoint } from './resort-navigation.ts';
import { WATER_ACTIVITIES, matchWaterActivity } from './water-activity.ts';
import './lake.css';

export function mountFishing(root:HTMLElement,exit:()=>void){
  const panel=document.createElement('section');panel.className='practice-lake';
  panel.innerHTML=`<header><h2>Freshwater lake</h2><button data-exit>Workshops</button></header>
    <div class="lake-grid"><div class="lake-water"><canvas aria-label="Choose a place to cast on the lake"></canvas></div>
    <div class="lake-controls"><label>Shore <select data-zone></select></label>
    <label>Bait <select data-bait><option value="worm">Earthworm</option><option value="corn">Corn</option><option value="insect">Stream insect</option><option value="minnow">Minnow</option></select></label>
    <label>Depth <select data-depth><option value="mid">Midwater</option><option value="surface">Surface</option><option value="bottom">Bottom</option></select></label>
    <p data-clue></p><output data-message role="status"></output>
    <div><button data-action>Cast line</button> <button data-retrieve hidden>Retrieve</button></div>
    <fieldset data-fight hidden><legend>Rod control</legend>
    <label>Direction <select data-direction><option value="0">Centre</option><option value="-1">Left</option><option value="1">Right</option></select></label>
    <label>Tip <select data-angle><option value="0">Level</option><option value="-1">Low</option><option value="1">High</option></select></label>
    <label>Drag <input data-drag type="range" min="0" max="1" value=".55" step=".05"></label>
    <button type="button" data-reel aria-pressed="false">Reel</button></fieldset>
    <small>Choose a shore or tap the lake to aim. Cast, wait for the float to dive, then strike. Follow the tension guide as you reel in.</small>
    <p data-catch></p></div></div>`;
  root.append(panel);
  const get=<T extends HTMLElement>(key:string)=>panel.querySelector<T>('[data-'+key+']')!;
  const canvas=panel.querySelector('canvas')!,ctx=canvas.getContext('2d')!;
  const zone=get<HTMLSelectElement>('zone'),bait=get<HTMLSelectElement>('bait'),depth=get<HTMLSelectElement>('depth');
  const action=get<HTMLButtonElement>('action'),retrieve=get<HTMLButtonElement>('retrieve'),reel=get<HTMLButtonElement>('reel'),controls=get<HTMLFieldSetElement>('fight');
  const direction=get<HTMLSelectElement>('direction'),angle=get<HTMLSelectElement>('angle'),drag=get<HTMLInputElement>('drag');
  const game=createFishingSession(),s=game.state,hud=createFightHud(canvas.parentElement!);
  let width=1,height=1,scale=1,clock=0,last=0,request=0,reeling=false,previousPhase='',caught=0;
  let target={x:4,z:7.5};
  const background=document.createElement('canvas');
  for(const spot of FISHING_ZONES)zone.add(new Option(spot.name,spot.id));
  function project(x:number,z:number){return {x:width/2+x*scale,y:height/2+(z+48)*scale};}
  function drawBackground(){
    const g=background.getContext('2d')!;
    g.fillStyle='#b4be95';g.fillRect(0,0,width,height);
    const gradient=g.createLinearGradient(0,0,width,height);gradient.addColorStop(0,'#8cbab0');gradient.addColorStop(.42,'#4b8284');gradient.addColorStop(1,'#28595f');
    g.beginPath();
    for(let n=0;n<=256;n++){const p=shorePoint(n/256*Math.PI*2,0),v=project(p.x,p.z);if(n)g.lineTo(v.x,v.y);else g.moveTo(v.x,v.y);}
    g.closePath();g.fillStyle=gradient;g.fill();g.strokeStyle='#c9c794';g.lineWidth=5;g.stroke();
    g.save();g.clip();g.strokeStyle='#e7f3c01c';g.lineWidth=1;
    for(let i=0;i<100;i++){
      const x=(i*1543%991)*width/991,y=(i*739%853)*height/853,len=4+7*(i%6);
      g.beginPath();g.moveTo(x,y);g.quadraticCurveTo(x+len/2,y+2,x+len,y);g.stroke();
    }g.restore();
    const dock=project(0,28);g.fillStyle='#6b5842';g.fillRect(dock.x-4,dock.y-6*scale,8,14*scale);
    for(const mark of WATER_ACTIVITIES){const p=project(mark.x,mark.z);g.strokeStyle='#e4efd499';g.lineWidth=1.3;for(const r of [4,9,14]){g.beginPath();g.ellipse(p.x,p.y,r,r*.4,0,0,Math.PI*2);g.stroke();}}
  }
  function resize(){
    width=Math.max(1,canvas.clientWidth);height=Math.max(1,canvas.clientHeight);scale=Math.min(width/148,height/178);
    const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    background.width=Math.ceil(width);background.height=Math.ceil(height);ctx.setTransform(dpr,0,0,dpr,0,0);drawBackground();
  }
  const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
  function updateShore(){
    const site=WATER_ACTIVITIES.find(a=>a.zone===zone.value)!;
    target={x:site.x,z:site.z};get('clue').textContent=site.clue;
  }
  zone.onchange=updateShore;updateShore();
  canvas.onpointerdown=(e)=>{
    if(s.phase!=='ready')return;
    const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left-width/2)/scale,z=(e.clientY-r.top-height/2)/scale-48;
    if(lakeDistance(x,z)>-.8)return;
    target={x,z};zone.value=fishingZoneAt(x,z);get('clue').textContent=WATER_ACTIVITIES.find(a=>a.zone===zone.value)!.clue;
  };
  function cast(){
    const chosenBait=bait.value as FishingBait,chosenDepth=depth.value as FishingDepth;
    const selected=FISHING_ZONES.find(v=>v.id===zone.value)!,standing=shorePoint(selected.angle);
    const near=matchWaterActivity(target.x,target.z,chosenBait,chosenDepth);
    const power=Math.max(.14,Math.min(1,Math.hypot(target.x-standing.x,target.z-standing.z)/38));
    return game.cast(power,{zone:selected.id,bait:chosenBait,depth:chosenDepth,activityId:near?.id});
  }
  function operate(){if(s.phase==='ready')cast();else if(s.phase==='bite'||s.phase==='waiting')game.hook();else if(s.phase==='caught')game.release();}
  action.onclick=operate;retrieve.onclick=()=>{game.retrieve();};get('exit').onclick=exit;
  function setReel(value:boolean){reeling=value;reel.setAttribute('aria-pressed',String(value));reel.textContent=value?'Give line':'Reel';}
  reel.onclick=()=>setReel(!reeling);
  function frame(now:number){
    const dt=Math.min(.1,Math.max(0,(now-last)/1000));last=now;clock+=dt;
    game.tick(dt,{reeling,drag:Number(drag.value),rodAngle:Number(angle.value),rodDirection:Number(direction.value)});
    game.drainEvents();hud.update(dt,s,reeling);
    const phase=s.phase,activeLine=phase!=='ready'&&phase!=='escaped'&&phase!=='caught';
    if(previousPhase!==phase){
      if(phase!=='reeling')setReel(false);
      controls.hidden=phase!=='reeling';retrieve.hidden=!['casting','waiting','bite'].includes(phase);
      action.hidden=phase==='reeling'||phase==='casting'||phase==='escaped';
      action.textContent=phase==='caught'?'Release fish':phase==='waiting'||phase==='bite'?'Strike':'Cast line';
      zone.disabled=bait.disabled=depth.disabled=phase!=='ready';previousPhase=phase;
      if(phase==='caught'&&s.catch){const fish=getFishSpecies(s.catch.speciesId);get('catch').textContent=fish.name+' · '+s.catch.lengthCm+' cm · '+s.catch.weightKg+' kg · '+fish.scientificName;caught++;}
    }
    const message=phase==='ready'?'Ready to cast'+(caught?' · '+caught+' landed':''):phase==='casting'?'Casting…'
      :phase==='waiting'?s.cue==='wrong-bait'?'No interest. Try another bait or depth.':s.biteStage==='taste'?'The float is trembling.':'Watch the float…'
      :phase==='bite'?'Float submerged — strike now!':phase==='caught'?'Landed':phase==='escaped'?'Fish lost · '+String(s.failureReason).replaceAll('-',' ')
      :'Line '+s.distance.toFixed(1)+' m · Tension '+Math.round(s.tension*100)+'%';
    if(get('message').textContent!==message)get('message').textContent=message;
    ctx.clearRect(0,0,width,height);ctx.drawImage(background,0,0,width,height);
    const bank=shorePoint(FISHING_ZONES.find(v=>v.id===zone.value)!.angle),start=project(bank.x,bank.z),end=project(target.x,target.z);
    const t=phase==='casting'?Math.min(1,s.phaseTime/CAST_DURATION):phase==='reeling'?Math.max(.04,s.distance/Math.max(.1,s.castDistance)):1;
    const fx=start.x+(end.x-start.x)*t,fy=start.y+(end.y-start.y)*t-(phase==='casting'?Math.sin(t*Math.PI)*42:0);
    if(activeLine){
      ctx.strokeStyle='#e8e9ca';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.quadraticCurveTo((start.x+fx)/2+6,(start.y+fy)/2,fx,fy);ctx.stroke();
      const motion=floatMotion(phase,s.phaseTime,clock,s.nibble,.24,s.feedback,{biteStage:s.biteStage});
      ctx.save();ctx.translate(fx,fy-motion.y*40);ctx.rotate(motion.tilt);ctx.lineWidth=3;ctx.strokeStyle='#e6ecd8';
      ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-8);ctx.stroke();ctx.strokeStyle='#f76737';ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(0,-14);ctx.stroke();ctx.restore();
    }else{ctx.strokeStyle='#fff5bd';ctx.lineWidth=2;ctx.beginPath();ctx.arc(end.x,end.y,7,0,Math.PI*2);ctx.stroke();}
    request=requestAnimationFrame(frame);
  }
  request=requestAnimationFrame(frame);
  return ()=>{cancelAnimationFrame(request);observer.disconnect();hud.dispose();panel.remove();};
}
