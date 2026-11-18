import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createWorldStreaming,validateWorldManifest} from '../../src/world/world-streaming.ts';
import {createPlayerController} from '../../src/exploration/player.ts';
const require=createRequire(new URL('../../package.json',import.meta.url));
const THREE=await import(require.resolve('three').replace(/three\.cjs$/,'three.module.js'));
const cell=(id,x,max=x+10)=>({id,sceneUrl:`/${id}.json`,bounds:{min:[x,0,-10],max:[max,30,10]},hasCollision:true});
const manifest=cells=>({schemaVersion:1,cells,collisionLoadDistance:12,collisionUnloadDistance:25,visualLoadDistance:30,visualUnloadDistance:45,maxConcurrent:2});
function harness(cells,extra={}){
 const events=[],m=manifest(cells);
 const hooks={fragment:async c=>{events.push(`fragment:${c.id}`);return c;},collision:async c=>{events.push(`collision:${c.id}`);return {release(){events.push(`release-collision:${c.id}`);}};},visual:async c=>{events.push(`visual:${c.id}`);return {release(){events.push(`release-visual:${c.id}`);}};},...extra};
 return {events,stream:createWorldStreaming(m,hooks)};
}
test('spawn loads only nearby collision; shared cell requests deduplicate and visual/collision residency differ',async()=>{
 const {stream,events}=harness([cell('a',0),cell('b',25),cell('remote',3000)]);
 await stream.ensureCollision([1,0,0]);stream.pinBootstrap();
 assert.deepEqual(events,['fragment:a','collision:a']);
 for(let i=0;i<10;i++)stream.update([1,0,0],[1,0,0]);await stream.whenIdle();
 assert.equal(events.filter(x=>x==='fragment:a').length,1);assert.equal(events.filter(x=>x==='collision:a').length,1);
 assert.equal(events.includes('visual:b'),true);assert.equal(events.includes('collision:b'),false);assert.equal(events.some(x=>x.includes('remote')),false);
 stream.update([28,0,0],[28,0,0]);assert.equal(stream.canEnter([28,0,0]),false);await stream.whenIdle();assert.equal(stream.canEnter([28,0,0]),true);
 stream.update([150,0,0],[150,0,0]);await stream.whenIdle();
 assert.equal(events.includes('release-collision:b'),true);assert.equal(events.includes('release-collision:a'),false,'immutable bootstrap stays pinned');
 assert.equal(events.includes('release-visual:a'),true);stream.dispose();
});
test('failed collision never permits entry; retry preserves failure evidence and resumes on success',async()=>{
 let fail=true,time=0;
 const {stream}=harness([cell('a',0)],{now:()=>time,collision:async()=>{if(fail)throw new Error('HTTP 503');return {release(){}};}});
 await assert.rejects(stream.ensureCollision([1,0,0]),/HTTP 503/);assert.equal(stream.canEnter([1,0,0]),false);
 assert.equal(stream.snapshot().errors.length,1);fail=false;time=3100;stream.update([1,0,0],[1,0,0]);await stream.whenIdle();assert.equal(stream.canEnter([1,0,0]),true);stream.dispose();
});
test('late completion after leaving or disposal releases exactly once and never attaches stale state',async()=>{
 let resolve,release=0;
 const {stream}=harness([cell('a',0)],{collision:async()=>new Promise(r=>resolve=()=>r({release(){release++;}}))});
 stream.update([1,0,0],[1,0,0]);await new Promise(r=>setImmediate(r));stream.update([500,0,0],[500,0,0]);resolve();await stream.whenIdle();assert.equal(release,1);assert.equal(stream.snapshot().collisionResident,0);stream.dispose();assert.equal(release,1);
});
test('invalid bounds and duplicate cell/resource URL rejected before any load',()=>{
 assert.throws(()=>validateWorldManifest(manifest([cell('a',0),cell('a',20)])),/Duplicate/);
 assert.throws(()=>validateWorldManifest(manifest([cell('a',0),{...cell('b',20),sceneUrl:'/a.json'}])),/Duplicate/);
 assert.throws(()=>validateWorldManifest(manifest([{...cell('a',0),bounds:{min:[NaN,0,0],max:[1,1,1]}}])),/bounds/);
});
test('one actual Rapier player walks across adjacent dynamically added cells, retains support, and unloads distant collision',async()=>{
 const cells=[cell('a',-20,20),cell('b',20,60),cell('c',60,100)],collisionRoot=new THREE.Group();
 let player,created=0;const added=[],removed=[];
 const stream=createWorldStreaming(manifest(cells),{
  fragment:async c=>c,
  collision:async c=>{
   const root=new THREE.Group(),floor=new THREE.Mesh(new THREE.BoxGeometry(c.bounds.max[0]-c.bounds.min[0],.4,20),new THREE.MeshBasicMaterial());
   floor.position.set((c.bounds.max[0]+c.bounds.min[0])/2,-.2,0);root.add(floor);collisionRoot.add(root);root.updateMatrixWorld(true);
   const dynamic=!!player;if(player){player.setStaticCollision(c.id,root);added.push(c.id);}
   return {release(){if(dynamic){player.removeStaticCollision(c.id);removed.push(c.id);}root.removeFromParent();floor.geometry.dispose();floor.material.dispose();}};
  },visual:async()=>({release(){}}),
 });
 await stream.ensureCollision([0,.04,0]);stream.pinBootstrap();
 player=await createPlayerController(collisionRoot,new THREE.Vector3(0,.04,0),{object:new THREE.Group(),updateMotion(){},dispose(){}});created++;
 const original=player,move=new THREE.Vector3(1,0,0);let minY=Infinity;
 for(let i=0;i<2600&&player.position.x<90;i++){
  if(i%12===0){stream.update(player.position.toArray(),player.position.toArray());await stream.whenIdle();}
  const next=player.position.clone().addScaledVector(move,.8);
  player.update(1/120,stream.canEnter(next.toArray())?move:new THREE.Vector3(),true,false);minY=Math.min(minY,player.position.y);
 }
 assert.equal(created,1);assert.equal(player,original);assert.ok(player.position.x>89,`stopped at ${player.position.x}`);assert.ok(minY>-.04,`floor lost: ${minY}`);assert.equal(player.grounded,true);
 assert.deepEqual(added,['b','c']);assert.ok(removed.includes('b'),'distant dynamic floor unloaded only after player crossed to c');
 stream.dispose();player.dispose();
});
test('initial visuals finish before readiness and airborne focus retains the real feet collider',async()=>{
 const {stream,events}=harness([cell('a',0),cell('b',1000)]);
 await stream.ensureCollision([1,0,0]);stream.update([1,0,0],[1,0,0]);await stream.ensureVisual([1,0,0]);assert.equal(stream.snapshot().visualResident,1);
 // No bootstrap pin: this also checks a region entered later in the session.
 stream.update([1001,200,0],[1001,200,0],[1,0,0]);await stream.whenIdle();
 assert.equal(events.includes('release-collision:a'),false);assert.equal(events.includes('release-visual:a'),true);
 assert.equal(stream.canEnter([1,0,0]),true);assert.equal(stream.canEnter([1001,0,0]),true);stream.dispose();
});
test('arrival waits for the declared opposite frontage and retains its floor until committing',async()=>{
 let finishFrontage,entered=false;
 const cells=[cell('origin',0),cell('floor',1000),{...cell('frontage',1020),hasCollision:false}];
 const {stream}=harness(cells,{visual:async c=>c.id==='frontage'?new Promise(resolve=>finishFrontage=()=>resolve({release(){}})):{release(){}}});
 stream.update([0,0,0],[0,0,0]);await stream.whenIdle();
 const arrival=stream.ensureCollision([1001,0,0],async()=>{
  await stream.ensureVisual([1001,0,0],['floor','frontage']);
  assert.equal(stream.canEnter([1001,0,0]),true);
  assert.ok(stream.snapshot().resident.filter(c=>c.visual).some(c=>c.id==='frontage'));
  entered=true;stream.update([1001,0,0],[1001,0,0]);
 });
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(entered,false,'slow visible frontage must hold arrival');
 assert.equal(typeof finishFrontage,'function','explicit frontage 19m away is requested');
 stream.update([0,0,0],[0,0,0]);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(stream.canEnter([1001,0,0]),true,'old viewpoint cannot evict the destination floor during the wait');
 finishFrontage();await arrival;await stream.whenIdle();assert.equal(entered,true);stream.dispose();
});
test('a failed entrance visual does not commit arrival or leave its collision force active',async()=>{
 const {stream}=harness([cell('origin',0),cell('target',1000)],{visual:async c=>{if(c.id==='target')throw new Error('frontage unavailable');return {release(){}};}});
 stream.update([0,0,0],[0,0,0]);await stream.whenIdle();let entered=false;
 await assert.rejects(stream.ensureCollision([1001,0,0],async()=>{await stream.ensureVisual([1001,0,0],['target']);entered=true;}),/frontage unavailable/);
 assert.equal(entered,false);stream.update([0,0,0],[0,0,0]);await stream.whenIdle();
 assert.equal(stream.canEnter([1001,0,0]),false);await stream.ensureCollision([1,0,0]);stream.dispose();
});
test('failed arrival leaves the old visible street resident through an unrelated completion',async()=>{
 let finishBackground;
 const {stream}=harness([cell('origin',0),{...cell('background',20),hasCollision:false},cell('target',1000)],{visual:async c=>{
  if(c.id==='target')throw new Error('frontage unavailable');
  if(c.id==='background')return new Promise(resolve=>finishBackground=()=>resolve({release(){}}));
  return {release(){}};
 }});
 stream.update([0,0,0],[0,0,0]);await new Promise(resolve=>setImmediate(resolve));
 try {
  await assert.rejects(stream.ensureCollision([1001,0,0],()=>stream.ensureVisual([1001,0,0],['target'])),/frontage unavailable/);
  finishBackground();await stream.whenIdle();
  assert.ok(stream.snapshot().resident.some(c=>c.id==='origin'&&c.visual),'a failed arrival must not switch visual focus before a new frame');
 } finally {stream.dispose();}
});
test('explicit arrival visuals finish even while an unrelated old visual holds the ordinary slot',async()=>{
 let finishOld,entered=false;
 const {stream}=harness([cell('origin',0),cell('target',1000)],{visual:async c=>c.id==='origin'?new Promise(resolve=>finishOld=()=>resolve({release(){}})):{release(){}}});
 stream.update([0,0,0],[0,0,0]);await new Promise(resolve=>setImmediate(resolve));
 try {
  await stream.ensureCollision([1001,0,0],async()=>{
   await stream.ensureVisual([1001,0,0],['target']);entered=true;stream.update([1001,0,0],[1001,0,0]);
  });
  assert.equal(entered,true,'arrival does not depend on the old texture response');
  assert.ok(stream.snapshot().resident.some(c=>c.id==='target'&&c.visual&&c.collision));
 } finally {stream.dispose();finishOld();await stream.whenIdle();}
});
test('slow visual loads leave a slot for a newly required collision destination',async()=>{
 const blockers=[];let requested=false;
 const cells=[{...cell('visual-a',0),hasCollision:false},{...cell('visual-b',1),hasCollision:false},cell('target',1000)];
 const stream=createWorldStreaming(manifest(cells),{fragment:async c=>c,visual:async()=>new Promise(resolve=>blockers.push(()=>resolve({release(){}}))),collision:async()=>{requested=true;return {release(){}};}});
 stream.update([0,0,0],[0,0,0]);await new Promise(resolve=>setImmediate(resolve));
 const loading=stream.ensureCollision([1001,0,0]);await new Promise(resolve=>setImmediate(resolve));assert.equal(requested,true,'destination collision starts while old visuals remain unresolved');await loading;
 stream.dispose();for(const release of blockers)release();await stream.whenIdle();
});
test('rejected shared resource cache is evicted and a later request can recover',async()=>{
 const {cachedLoad}=await import('../../src/world/world-streaming.ts');const cache=new Map();let attempts=0;
 const first=cachedLoad(cache,'texture',async()=>{attempts++;throw new Error('temporary HTTP failure');});
 const same=cachedLoad(cache,'texture',async()=>{throw new Error('must deduplicate');});assert.equal(first,same);
 await assert.rejects(first,/temporary/);assert.equal(cache.has('texture'),false);
 assert.equal(await cachedLoad(cache,'texture',async()=>{attempts++;return 'decoded';}),'decoded');assert.equal(attempts,2);
});

test('one concurrency slot is rejected because visuals must not consume the collision reserve',()=>{
 assert.throws(()=>createWorldStreaming({...manifest([cell('a',0)]),maxConcurrent:1},{fragment:async()=>({}),collision:async()=>({release(){}}),visual:async()=>({release(){}})}),/reserved slot/);
});

test('frustum candidates add bounded distant visuals with shared URL costs, never distant physics',async()=>{
 const bytes=(...entries)=>entries.map(([url,bytes])=>({url,bytes}));
 const cells=[{...cell('local',0),visualDependencies:bytes(['/shared',80])},{...cell('far-a',1000),visualDependencies:bytes(['/shared',80],['/a',30])},{...cell('far-b',2000),visualDependencies:bytes(['/shared',80],['/b',40])},{...cell('too-large',3000),visualDependencies:bytes(['/huge',200])}];
 const tiers=[],{stream,events}=harness(cells,{visual:async(c,f,s,distant)=>{tiers.push([c.id,distant]);return {release(){}};}});
 stream.update([0,0,0],[0,0,0],undefined,{candidates:[{id:'far-a',priority:4},{id:'far-b',priority:3},{id:'too-large',priority:2}],maxBytes:75,maxCells:2});await stream.whenIdle();
 assert.equal(stream.snapshot().distantVisuals.estimatedAdditionalBytes,70);assert.deepEqual(stream.snapshot().distantVisuals.selected,['far-a','far-b']);
 assert.deepEqual(tiers,[['local',false],['far-a',true],['far-b',true]]);assert.equal(events.filter(x=>x.startsWith('collision:')).length,1);
 stream.update([0,0,0],[0,0,0]);await stream.whenIdle();assert.equal(stream.snapshot().visualResident,1);assert.equal(stream.snapshot().collisionResident,1);stream.dispose();
});
test('distant coarsest becomes normal LOD only on approach; old tier survives failed replacement then releases once',async()=>{
 let fail=false,time=0;const releases=[],tiers=[];
 const {stream}=harness([cell('remote',1000)],{now:()=>time,visual:async(c,f,s,d)=>{tiers.push(d);if(fail)throw new Error('replacement failed');return {release(){releases.push(d);}};}});
 const demand={candidates:[{id:'remote',priority:1}]};
 stream.update([0,0,0],[0,0,0],undefined,demand);await stream.whenIdle();assert.equal(stream.snapshot().resident[0].distant,true);
 fail=true;stream.update([0,0,0],[1000,0,0]);await stream.whenIdle();assert.equal(stream.snapshot().visualResident,1);assert.deepEqual(releases,[]);
 fail=false;time=3101;stream.update([0,0,0],[1000,0,0]);await stream.whenIdle();assert.deepEqual(releases,[true]);assert.equal(stream.snapshot().resident[0].distant,false);
 stream.update([0,0,0],[0,0,0],undefined,demand);await stream.whenIdle();assert.deepEqual(releases,[true,false]);
 stream.update([0,0,0],[0,0,0]);await stream.whenIdle();assert.deepEqual(releases,[true,false,true]);stream.dispose();
});
test('aborted view-tier request cannot replace the still current near visual',async()=>{
 let finishFar,releaseFar=0,releaseNear=0;
 const {stream}=harness([cell('remote',1000)],{visual:async(c,f,s,d)=>d?new Promise(resolve=>finishFar=()=>resolve({release(){releaseFar++;}})):{release(){releaseNear++;}}});
 stream.update([0,0,0],[1000,0,0]);await stream.whenIdle();
 stream.update([0,0,0],[0,0,0],undefined,{candidates:[{id:'remote',priority:1}]});await new Promise(r=>setImmediate(r));
 stream.update([0,0,0],[1000,0,0]);finishFar();await stream.whenIdle();
 assert.equal(releaseFar,1);assert.equal(releaseNear,0);assert.equal(stream.snapshot().resident[0].distant,false);stream.dispose();assert.equal(releaseNear,1);
});
test('invalid byte metadata cannot bypass the remote file budget',()=>{
 assert.throws(()=>validateWorldManifest(manifest([{...cell('a',0),visualDependencies:[{url:'/a',bytes:NaN}]}])),/byte metadata/);
 assert.throws(()=>validateWorldManifest(manifest([{...cell('a',0),estimatedVisualBytes:-1}])),/byte metadata/);
});

test('interactive cell stays visible far-to-near until collision takes over, and never duplicates on leaving',async()=>{
 let staticCount=0,interactiveCount=0,resolveCollision;
 const {stream}=harness([cell('door',1000)],{
  visual:async()=>{staticCount++;return {release(){staticCount--;}};},
  collision:async()=>new Promise(resolve=>resolveCollision=()=>{interactiveCount++;resolve({pinned:true,ownsVisual:true,release(){interactiveCount--;}});}),
 });
 const demand={candidates:[{id:'door',priority:1}]};
 stream.update([0,0,0],[0,0,0],undefined,demand);await stream.whenIdle();assert.equal(staticCount,1);
 stream.update([0,0,0],[990,0,0]);await stream.whenIdle();assert.equal(staticCount,1,'near exterior must remain before collision approach');
 stream.update([1000,0,0],[1000,0,0]);await new Promise(r=>setImmediate(r));assert.equal(staticCount,1,'in-flight collision must not hide exterior');
 resolveCollision();await stream.whenIdle();assert.equal(interactiveCount,1);assert.equal(staticCount,0,'takeover actually disposes duplicate static visual');
 await stream.ensureVisual([1000,0,0]);assert.equal(stream.snapshot().visualResident,1);
 stream.update([0,0,0],[0,0,0],undefined,demand);await stream.whenIdle();assert.equal(interactiveCount,1);assert.equal(staticCount,0,'pinned door remains sole visual owner even in far view');
 stream.dispose();assert.equal(interactiveCount,0);assert.equal(staticCount,0);
});

test('successful interactive ownership supersedes a prior static visual failure',async()=>{
 const {stream}=harness([cell('door',1000)],{visual:async()=>{throw new Error('old static HTTP failure');},collision:async()=>({pinned:true,ownsVisual:true,release(){}})});
 stream.update([0,0,0],[1000,0,0]);await stream.whenIdle();assert.equal(stream.snapshot().errors.length,1);
 await stream.ensureCollision([1000,0,0]);await stream.ensureVisual([1000,0,0]);assert.equal(stream.snapshot().visualResident,1);assert.equal(stream.snapshot().errors.length,0);stream.dispose();
});

test('collisionCellsNear lists only collision-bearing cells within the distance so per-frame probes stay local',()=>{
 const cells=[cell('a',0),cell('b',10),{...cell('c',20),hasCollision:false},cell('d',60)];
 const {stream}=harness(cells);
 assert.deepEqual(stream.collisionCellsNear([5,0,0],2),['a']);
 assert.deepEqual(stream.collisionCellsNear([10,0,0],2),['a','b'],'a point on the shared edge belongs to both cells');
 assert.deepEqual(stream.collisionCellsNear([25,0,0],2),[],'cells without collision never host a probe');
 assert.deepEqual(stream.collisionCellsNear([58,0,0]),['d'],'default distance matches entry checks');
 stream.dispose();
});

test('navigation keeps the real destination floor through an old texture completion before the next frame',async()=>{
 const cells=[cell('origin',-10,10),cell('destination',990,1010)],root=new THREE.Group();
 let player,finishOldVisual;const removed=[];
 const stream=createWorldStreaming(manifest(cells),{
  fragment:async c=>c,
  collision:async c=>{
   const group=new THREE.Group(),floor=new THREE.Mesh(new THREE.BoxGeometry(20,.4,20),new THREE.MeshBasicMaterial());
   floor.position.set((c.bounds.min[0]+c.bounds.max[0])/2,-.2,0);group.add(floor);root.add(group);group.updateMatrixWorld(true);
   const registered=!!player;if(registered)player.setStaticCollision(c.id,group);
   return {release(){if(registered){player.removeStaticCollision(c.id);removed.push(c.id);}group.removeFromParent();floor.geometry.dispose();floor.material.dispose();}};
  },
  visual:async c=>c.id==='origin'?new Promise(resolve=>{finishOldVisual=()=>resolve({release(){}});}):{release(){}},
 });
 try {
  await stream.ensureCollision([0,.04,0]);stream.pinBootstrap();
  player=await createPlayerController(root,new THREE.Vector3(0,.04,0),{object:new THREE.Group(),updateMotion(){},dispose(){}});
  stream.update([0,.04,0],[0,2,0],[0,.04,0]);await new Promise(resolve=>setImmediate(resolve));
  const destination=[1000,.04,0];
  await stream.ensureCollision(destination,()=>{
   player.teleport(new THREE.Vector3(...destination));
   // The adapter commits residency with the teleport, before yielding to other loads.
   stream.update(player.position.toArray(),[1000,2,0],player.position.toArray());
  });
  finishOldVisual();await stream.whenIdle();
  assert.equal(stream.canEnter(destination),true,'late old visual work must not unload the destination');
  assert.equal(removed.includes('destination'),false);
  for(let i=0;i<60;i++)player.update(1/120,new THREE.Vector3(),false,false);
  assert.ok(Math.abs(player.position.x-1000)<.1,'same player entered the destination');
  assert.ok(player.position.y>-.04,'real destination floor remains under the player');assert.equal(player.grounded,true);
 } finally {stream.dispose();player?.dispose();}
});

test('network prefetch proceeds while preparation is saturated, with collision capacity in both queues',async()=>{
 const visualCells=Array.from({length:14},(_,i)=>({...cell(`v${i}`,i),hasCollision:false})),floor=cell('floor',1000),preparing=[],prefetched=[],gates=[];
 const stream=createWorldStreaming({...manifest([...visualCells,floor]),maxConcurrent:4,maxPrefetch:10},{
  fragment:async c=>c,
  prefetch:async(c,_f,_s,kind)=>{prefetched.push(`${kind}:${c.id}`);return {release(){}};},
  visual:async c=>{preparing.push(c.id);await new Promise(resolve=>gates.push(resolve));return {release(){}};},
  collision:async c=>{preparing.push(c.id);return {release(){}};},
 });
 stream.update([0,0,0],[0,0,0]);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(preparing.length,3,'preparation keeps the fourth slot for collision');
 assert.ok(prefetched.length>=10,'downloads continue independently of the three blocked preparations');
 assert.ok(stream.snapshot().preparedWaiting>=7);assert.equal(stream.snapshot().activePrepare,3);
 const arrival=stream.ensureCollision([1001,0,0]);await arrival;
 assert.ok(preparing.includes('floor'),'collision starts while all ordinary visual preparation slots remain held');
 stream.dispose();for(const resolve of gates)resolve();await stream.whenIdle();assert.equal(stream.snapshot().active,0);
});

test('obsolete prepared work is released before it can parse or attach, and disposal drains every prefetch lease',async()=>{
 const releases=[],parsed=[],gates=[];
 const cells=Array.from({length:8},(_,i)=>({...cell(`v${i}`,i),hasCollision:false}));
 const stream=createWorldStreaming({...manifest(cells),maxConcurrent:2,maxPrefetch:10},{
  fragment:async c=>c,prefetch:async c=>({release(){releases.push(c.id);}}),collision:async()=>({release(){}}),
  visual:async c=>{parsed.push(c.id);await new Promise(resolve=>gates.push(resolve));return {release(){releases.push(`visual:${c.id}`);}};},
 });
 stream.update([0,0,0],[0,0,0]);await new Promise(resolve=>setImmediate(resolve));assert.equal(parsed.length,1);
 stream.update([2000,0,0],[2000,0,0]);await new Promise(resolve=>setImmediate(resolve));
 for(const resolve of gates)resolve();await stream.whenIdle();
 assert.equal(parsed.length,1,'stale ready models never use a preparation slot');
 assert.equal(releases.filter(id=>!id.startsWith('visual:')).length,8);assert.equal(new Set(releases).size,releases.length);
 assert.equal(stream.snapshot().visualResident,0);stream.dispose();assert.equal(stream.snapshot().active,0);
});

test('stationary pumps skip unrelated city blocks and keep an earlier resident within its unload radius', async () => {
  let distantBoundsReads = 0;
  const distant = Array.from({ length: 240 }, (_, i) => {
    const c = cell('remote-' + i, 2000 + i * 40), bounds = c.bounds;
    return { ...c, get bounds() { distantBoundsReads++; return bounds; } };
  });
  const { stream, events } = harness([cell('origin', 0), cell('street', 40), ...distant]);
  stream.update([0, 0, 0], [0, 0, 0]); await stream.whenIdle();
  distantBoundsReads = 0;
  stream.update([45, 0, 0], [45, 0, 0]); await stream.whenIdle();
  assert.deepEqual(stream.snapshot().loadedCells, ['origin', 'street']);
  assert.equal(stream.snapshot().resident[0].collision, false);
  assert.equal(stream.nearOutstanding(), 0);
  stream.update([80, 0, 0], [80, 0, 0]); await stream.whenIdle();
  assert.deepEqual(stream.snapshot().loadedCells, ['street']);
  assert.equal(events.filter(event => event === 'release-visual:origin').length, 1);
  assert.equal(distantBoundsReads, 0);
  stream.dispose();
});

test('a failed cell keeps its error while travelling and clears it on a successful return', async () => {
  let now = 1000, fail = true;
  const { stream } = harness([cell('a', 0), cell('b', 2000)], {
    now: () => now,
    visual: async c => {
      if (c.id === 'a' && fail) throw Error('asset missing');
      return { release() {} };
    },
  });
  stream.update([0, 0, 0], [0, 0, 0]); await stream.whenIdle();
  stream.update([2000, 0, 0], [2000, 0, 0]); await stream.whenIdle();
  assert.deepEqual(stream.snapshot().loadedCells, ['b']);
  assert.deepEqual(stream.snapshot().errors, [{ id: 'a', kind: 'visual', error: 'asset missing' }]);
  fail = false; now += 3500;
  stream.update([0, 0, 0], [0, 0, 0]); await stream.whenIdle();
  assert.deepEqual(stream.snapshot().errors, []);
  assert.equal(stream.snapshot().resident[0].visual, true);
  stream.dispose();
});
