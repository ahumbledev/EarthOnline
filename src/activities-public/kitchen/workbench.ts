import { createKitchenSimulation, FOOD_KINDS, ITEM_LABELS, RECIPES } from './simulation.ts';

export function mountKitchen(host: HTMLElement, exit: () => void) {
  const kitchen = createKitchenSimulation();
  kitchen.chooseRecipe('tomato-soup');
  const root = document.createElement('section');
  root.className = 'workbench';
  root.innerHTML = `<header><h2>Test kitchen</h2><button data-back>Back to workshops</button></header>
    <div class="workbench-grid"><section><label>Recipe <select></select></label><ul data-ingredients></ul>
    <ol data-steps></ol><p data-verdict aria-live="polite"></p></section>
    <section><h3>Pantry</h3><div class="workbench-controls" data-pantry></div>
    <h3>Cooktop &amp; stations</h3><div class="workbench-controls" data-stations></div><p data-heat></p>
    <h3>Tools &amp; ingredients</h3><p>Pick up an item, then choose a station or another item.</p>
    <div class="workbench-controls" data-items></div><p data-held></p><p data-message role="status"></p>
    <button data-reset>Reset workbench</button></section></div>`;
  host.append(root);
  const find = <T extends HTMLElement = HTMLElement>(key: string) => root.querySelector<T>(key)!;
  const select = find<HTMLSelectElement>('select');
  for (const recipe of RECIPES) select.add(new Option(recipe.name,recipe.id));
  const itemButtons = new Map<string,HTMLButtonElement>();
  const stationNames: Record<string,string> = {
    'station:counter':'Set down on counter','station:board':'Cutting board','station:sink':'Fill at sink',
    'station:burner-left':'Set on left burner','station:burner-right':'Set on right burner',
    'heat:left':'Cycle left burner','heat:right':'Cycle right burner','flip':'Turn fish','station:serve':'Serve plate',
  };
  function button(node: HTMLElement, value: string, key: string) {
    const element = document.createElement('button');
    element.type='button'; element.dataset.target=key; element.textContent=value; node.append(element); return element;
  }
  for (const kind of FOOD_KINDS) button(find('[data-pantry]'),ITEM_LABELS[kind], 'source:'+kind);
  for (const [target, name] of Object.entries(stationNames)) button(find('[data-stations]'),name,target);
  function list(target: string, text: readonly string[]) {
    find(target).replaceChildren(...text.map(value=>{const li=document.createElement('li');li.textContent=value;return li;}));
  }
  function updateRecipe() {
    const recipe = RECIPES.find(item=>item.id===select.value)!;
    list('[data-ingredients]',recipe.ingredients);list('[data-steps]',recipe.steps);
  }
  function update() {
    const state=kitchen.state;
    const heat=['off','low','high'];
    find('[data-heat]').textContent=`Left burner · ${heat[state.burners.left]}   /   Right burner · ${heat[state.burners.right]}`;
    const held=state.items.find(item=>item.id===state.heldId);
    find('[data-held]').textContent=held?'Holding · '+ITEM_LABELS[held.kind]:'Hands free';
    for (const item of state.items) {
      let el=itemButtons.get(item.id);
      if(!el){el=button(find('[data-items]'),'', 'item:'+item.id);itemButtons.set(item.id,el);}
      const temp=(item.kind==='pot'||item.kind==='pan')?` · ${Math.round(item.temperature)}°C`:'';
      const water=item.kind==='pot'&&item.waterMl>0?` · ${Math.round(item.waterMl)} ml`:'';
      const progress=item.cooked>0?` · ${Math.round(item.cooked*100)}%`:'';
      el.textContent=`${ITEM_LABELS[item.kind]} · ${item.location}${item.cut?' · chopped':''}${temp}${water}${progress}`;
      el.setAttribute('aria-pressed',String(item.id===state.heldId));
    }
    for(const [id,el] of itemButtons) if(!state.items.some(item=>item.id===id)){el.remove();itemButtons.delete(id);}
    if(state.result) find('[data-verdict]').textContent=`${state.result.score} / 100 · ${state.result.title}. ${state.result.feedback}`;
  }
  select.onchange=()=>{kitchen.chooseRecipe(select.value); updateRecipe(); update();};
  root.onclick=(event)=>{
    const control=(event.target as HTMLElement).closest('button');
    if(!control)return;
    if(control.hasAttribute('data-back')){exit();return;}
    if(control.hasAttribute('data-reset')){kitchen.reset(); find('[data-verdict]').textContent='';find('[data-message]').textContent=''; update();return;}
    if(control.dataset.target){
      const target=control.dataset.target;
      const result=target==='flip'?kitchen.flip():kitchen.interact(target);
      find('[data-message]').textContent=result.message;update();
    }
  };
  let last=performance.now(),lastDraw=0,frame=0;
  const tick=(now:number)=>{
    kitchen.tick((now-last)/1000);last=now;
    if(now-lastDraw>=250){update();lastDraw=now;}
    frame=requestAnimationFrame(tick);
  };
  updateRecipe();update();frame=requestAnimationFrame(tick);
  return ()=>{cancelAnimationFrame(frame);root.remove();};
}
