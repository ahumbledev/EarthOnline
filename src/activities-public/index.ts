import { mountCoffee } from '../coffee/practice.ts';
import { WebGLRenderer } from 'three';
import type { GameView, GameViewContext } from './view.ts';
import { createRamenView } from './ramen/index.ts';
import { createIcecreamView } from './icecream/index.ts';
import { openPaintingEditor } from './painting/editor.ts';
import { openSketchbookSave } from './painting/sketchbook.ts';
import { createTailoringView } from './tailoring/index.ts';
import { mountFishing } from './fishing/lake.ts';
import { mountWashBay } from './carwash/workbench.ts';
import { mountKitchen } from './kitchen/workbench.ts';
import './painting/style.css';
import './workshops.css';

function mountScene(root: HTMLElement, factory: (context: GameViewContext, exit: () => void) => GameView, exit: () => void) {
  const renderer = new WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  let view: GameView;
  try { view = factory({container:root,renderer},exit); }
  catch(error){ renderer.dispose();renderer.forceContextLoss();throw error; }
  view.activate();
  const resize=()=>{
    const width=Math.max(root.clientWidth,1), height=Math.max(root.clientHeight,1);
    renderer.setSize(width,height,false);view.resize(width,height);
  };
  const observer=new ResizeObserver(resize);observer.observe(root);resize();
  renderer.setAnimationLoop((now)=>view.render(now));
  return ()=>{observer.disconnect();renderer.setAnimationLoop(null);view.deactivate();view.dispose();renderer.dispose();renderer.forceContextLoss();};
}

export function mountActivities(container: HTMLElement, onExit: () => void): () => void {
  const root = document.createElement('section');
  root.className='workshop-host';container.append(root);
  let live=true;
  let stop: (()=>void)|undefined;
  function cleanup(){const closing=stop;stop=undefined;closing?.();}
  function list(){
    if(!live)return;
    cleanup();
    root.innerHTML=`<div class="workshop-menu"><header><h2>Workshops</h2><button type="button" data-exit>Return to city</button></header><nav aria-label="Choose a workshop">
      <button data-work="coffee"><strong>Coffee counter</strong><span>Grind, extract and pour a practice drink.</span></button>
      <button data-work="ramen"><strong>Hand-pulled noodles</strong><span>Knead, stretch and fold dough.</span></button>
      <button data-work="icecream"><strong>Ice cream counter</strong><span>Time each scoop and balance the stack.</span></button>
      <button data-work="tailoring"><strong>Sewing atelier</strong><span>Cut patterns, sew each seam and keep a finished garment.</span></button>
      <button data-work="fishing"><strong>Freshwater lake</strong><span>Read the float, set the hook and land a fish.</span></button>
      <button data-work="carwash"><strong>Wash bay</strong><span>Pressure-wash a hatchback, sedan or van.</span></button>
      <button data-work="kitchen"><strong>Test kitchen</strong><span>Prepare one of fifteen recipes.</span></button>
      <button data-work="painting"><strong>Sketchbook</strong><span>Draw, keep a local draft or export a PNG.</span></button>
    </nav><p role="status"></p></div>`;
    root.querySelector<HTMLButtonElement>('[data-exit]')!.onclick=onExit;
    root.querySelector('nav')!.onclick=(event)=>{
      const key=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-work]')?.dataset.work;
      if(!key)return;
      root.replaceChildren();
      try{
        if(key==='ramen')stop=mountScene(root,createRamenView,list);
        else if(key==='icecream')stop=mountScene(root,createIcecreamView,list);
        else if(key==='tailoring')stop=mountScene(root,createTailoringView,list);
        else if(key==='coffee')stop=mountCoffee(root,list);
        else if(key==='fishing')stop=mountFishing(root,list);
        else if(key==='carwash')stop=mountWashBay(root,list);
        else if(key==='kitchen')stop=mountKitchen(root,list);
        else {
          const draft=openSketchbookSave(localStorage,'sketchbook','local');
          const close=openPaintingEditor({host:root,initial:draft.initial,onDraft:draft.save,onSave:draft.save,onClose:list});
          stop=()=>close(true);
        }
      }catch(error){list();const message=root.querySelector<HTMLElement>('[role=status]');if(message)message.textContent=error instanceof Error?error.message:'Unable to open this workshop.';}
    };
  }
  list();
  return ()=>{if(!live)return;live=false;cleanup();root.remove();};
}
