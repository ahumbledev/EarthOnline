import test from 'node:test';
import assert from 'node:assert/strict';
import { createFishingSession, CAST_DURATION, eligibleFish } from '../../src/activities-public/fishing/gameplay.ts';

function advance(s, seconds, reel = false, fps = 60) {
  for (let i = 0; i < seconds * fps; i++) s.tick(1 / fps, reel);
}
function hooked(patch = {}, random = () => 0) {
  const s = createFishingSession(random); s.configure(patch);
  assert.equal(s.cast(.5), true);
  for (let i=0; i<1600 && s.state.phase !== 'bite'; i++) s.tick(1/60, false);
  assert.equal(s.state.phase, 'bite'); assert.equal(s.hook(), true); return s;
}
function land(s) {
  for (let i=0; i<6000 && s.state.phase === 'reeling'; i++) {
    const a=s.state, surge=!a.telegraph && !['steady','recover'].includes(a.behavior);
    s.tick(1/60, { reeling:!surge && a.tension < .8, rodDirection:a.recommendedDirection, rodAngle:a.jumping ? -1 : 0, drag:surge ? .4 : .55 });
  }
}
test('the cast, bite, hook and release cycle accepts valid actions and lands exactly once', () => {
  const s = createFishingSession(() => 0);
  assert.equal(s.hook(), false); assert.equal(s.release(), false);
  assert.equal(s.cast(.5), true); assert.equal(s.cast(), false);
  advance(s, CAST_DURATION + 6.1); assert.equal(s.state.phase, 'bite'); s.hook();
  land(s); assert.equal(s.state.phase, 'caught'); assert.equal(s.state.catches, 1);
  assert.equal(s.state.distance, 0); assert.equal(s.state.tension, 0);
  advance(s, 2, true); assert.equal(s.state.catches, 1);
  assert.equal(s.release(), true); assert.equal(s.state.phase, 'ready');
  assert.equal(s.release(), false);
});
test('early and missed strikes have specific failure reasons', () => {
  const early = createFishingSession(() => 0); early.cast(); advance(early, 3);
  assert.equal(early.hook(), false); assert.equal(early.state.failureReason, 'early-strike');
  const missed = createFishingSession(() => 0); missed.cast(); advance(missed, 10.5);
  assert.equal(missed.state.phase, 'escaped'); assert.equal(missed.state.failureReason, 'missed-bite');
  assert.equal(missed.hook(), false);
});
test('line progress and tension agree at 30 and 120 fps; background deltas are bounded', () => {
  const a=hooked(), b=hooked(); advance(a,2,true,30); advance(b,2,true,120);
  assert.ok(Math.abs(a.state.distance-b.state.distance)<.000001);
  assert.ok(Math.abs(a.state.tension-b.state.tension)<.000001);
  const before=a.state.distance; a.tick(600,true);
  assert.ok(before-a.state.distance<.71); a.tick(Number.NaN,true);
  assert.ok(Number.isFinite(a.state.distance));
});
test('sustained slack loses a fish after a readable warning, rather than leaving an infinite idle fight', () => {
  const s=hooked({novice:false});
  advance(s, 1, {reeling:false,drag:0});
  assert.equal(s.state.phase, 'reeling'); assert.ok(s.state.slackTime > 0);
  let warning=false;
  for(let i=0;i<600 && s.state.phase==='reeling';i++) { s.tick(1/60,{reeling:false,drag:0}); warning ||= s.state.cue==='keep-contact'; }
  assert.equal(warning,true); assert.equal(s.state.phase,'escaped');
  assert.equal(s.state.failureReason,'hook-slipped'); assert.equal(s.state.catch,null);
});
test('specimens are fixed before the bite, exposed only after landing, and never rerolled', () => {
  let rolls = 0;
  const s = createFishingSession(() => { rolls++; return 0; });
  assert.equal(s.state.catch, null); s.cast(.5);
  const preBite={...s.state.encounter}, fixedRolls=rolls;
  assert.equal(preBite.speciesId,'bluegill'); assert.ok(fixedRolls>=5);
  assert.equal(s.configure({bait:'minnow'}),false);
  advance(s, CAST_DURATION + 6.1); assert.equal(rolls,fixedRolls); assert.equal(s.state.catch,null); s.hook();
  land(s); assert.equal(s.state.phase,'caught'); assert.equal(rolls,fixedRolls);
  const specimen=s.state.catch;
  assert.ok(specimen.id); assert.equal(specimen.speciesId,preBite.speciesId);
  assert.equal(specimen.lengthCm,preBite.lengthCm); assert.equal(specimen.weightKg,preBite.weightKg);
  assert.equal(s.state.length,specimen.lengthCm); assert.equal(s.state.weight,specimen.weightKg);
  s.release(); assert.equal(s.state.catch,specimen); s.cast(); assert.equal(s.state.catch,null);
});
test('zone, bait and depth determine eligibility; unsuitable setups give an early clue', () => {
  assert.ok(eligibleFish({zone:'mud-bay',bait:'corn',depth:'bottom'}).includes('common-carp'));
  assert.ok(!eligibleFish({zone:'mud-bay',bait:'corn',depth:'bottom'}).includes('rainbow-trout'));
  assert.ok(eligibleFish({zone:'inlet',bait:'insect',depth:'surface'}).includes('rainbow-trout'));
  assert.ok(!eligibleFish({zone:'inlet',bait:'insect',depth:'surface'}).includes('common-carp'));
  assert.deepEqual(eligibleFish({zone:'shallows',bait:'minnow',depth:'mid'}),['yellow-perch']);
  const s=createFishingSession(()=>0);s.cast(.6,{zone:'shallows',bait:'corn',depth:'bottom'});
  assert.equal(s.state.encounter,null); advance(s,CAST_DURATION+8);
  assert.equal(s.state.cue,'wrong-bait');assert.equal(s.state.phase,'waiting');
  advance(s,2.2); assert.equal(s.state.failureReason,'no-interest');
});
test('the second novice fish can be selected without bypassing bait eligibility', () => {
  const s=hooked({novice:true,preferredSpecies:'yellow-perch'});
  assert.equal(s.state.encounter.speciesId,'yellow-perch');assert.equal(s.state.biteWindow,3);
  const other=createFishingSession(()=>0);other.cast(.5,{preferredSpecies:'northern-pike'});
  assert.equal(other.state.encounter.speciesId,'bluegill');
});
test('discrete events are ordered, consumable and do not replay after landing', () => {
  const s=hooked(); const opening=s.drainEvents();
  assert.deepEqual(opening.map(e=>e.type),['castRelease','waterImpact','biteCommitted','hookSet']);
  land(s); const combat=s.drainEvents();
  assert.ok(combat.some(e=>e.type==='reelStart'));assert.ok(combat.some(e=>e.type==='reelStop'));
  assert.equal(combat.filter(e=>e.type==='landed').length,1);
  advance(s,2,true);assert.deepEqual(s.drainEvents(),[]);
  assert.ok(combat.every((e,i)=>i===0 || e.serial>combat[i-1].serial));
});
test('keeping a landed fish returns to ready without a water-release event', () => {
  const s=createFishingSession(()=>0);
  assert.equal(s.keep(),false); s.cast();assert.equal(s.keep(),false);
  advance(s,CAST_DURATION+6.1);s.hook();assert.equal(s.keep(),false);
  land(s);assert.equal(s.state.phase,'caught');
  const specimen=s.state.catch;s.drainEvents();
  assert.equal(s.keep(),true);assert.equal(s.state.phase,'ready');assert.equal(s.state.distance,0);assert.equal(s.state.tension,0);
  assert.equal(s.state.catch,specimen);assert.deepEqual(s.drainEvents(),[]);assert.equal(s.keep(),false);
});
test('retrieve clears an unhooked cast in every valid phase without settling a fish', () => {
  for(const [phase,seconds] of [['casting',.2],['waiting',CAST_DURATION+.5],['bite',CAST_DURATION+6.1]]) {
    const s=createFishingSession(()=>0);s.cast();advance(s,seconds);assert.equal(s.state.phase,phase);
    assert.ok(s.state.encounter);s.drainEvents();
    assert.equal(s.retrieve(),true);assert.equal(s.state.phase,'ready');
    assert.equal(s.state.encounter,null);assert.equal(s.state.catch,null);assert.equal(s.state.distance,0);
    assert.equal(s.state.castDistance,0);assert.equal(s.state.tension,0);assert.equal(s.state.nibble,0);
    assert.equal(s.state.catches,0);assert.equal(s.state.failureReason,null);assert.deepEqual(s.drainEvents(),[]);
    advance(s,12);assert.equal(s.state.phase,'ready');assert.equal(s.hook(),false);
    assert.equal(s.cast(),true,'a retrieved cast can immediately be replaced');
  }
});
test('retrieve cannot cancel a hooked fight or a landed specimen', () => {
  const s=createFishingSession(()=>0);assert.equal(s.retrieve(),false);
  const fight=hooked(),identity={...fight.state.encounter};assert.equal(fight.retrieve(),false);
  assert.equal(fight.state.phase,'reeling');assert.deepEqual(fight.state.encounter,identity);
  land(fight);const specimen=fight.state.catch;assert.equal(fight.retrieve(),false);
  assert.equal(fight.state.phase,'caught');assert.equal(fight.state.catch,specimen);assert.equal(fight.state.catches,1);
  s.cast();advance(s,CAST_DURATION+9.1);assert.equal(s.state.phase,'escaped');assert.equal(s.retrieve(),false);
});
test('actual radial player movement changes retrieval distance and the time needed to land', () => {
  const away=hooked(),toward=hooked(),stationary=hooked();
  const start=away.state.distance;
  for(let i=0;i<8;i++) { away.applyPlayerMovement(.5);toward.applyPlayerMovement(-.5); }
  assert.equal(away.state.distance,start+4);assert.equal(toward.state.distance,start-4);
  const timings=[];
  for(const session of [toward,stationary,away]) {
    let frames=0;
    for(;frames<6000&&session.state.phase==='reeling';frames++) {
      const a=session.state,attack=!a.telegraph&&!['steady','recover'].includes(a.behavior);
      session.tick(1/60,{reeling:!attack&&a.tension<.8,rodDirection:a.recommendedDirection,rodAngle:a.jumping?-1:0,drag:attack?.4:.55});
    }
    assert.equal(session.state.phase,'caught');timings.push(frames);
  }
  assert.ok(timings[0]<timings[1]&&timings[1]<timings[2],`landing frames toward/still/away: ${timings}`);
});
test('movement uses finite half-metre steps, warns at the line limit and cannot bypass valid phases', () => {
  const s=createFishingSession(()=>0);assert.equal(s.applyPlayerMovement(1),0);
  s.cast();assert.equal(s.applyPlayerMovement(1),0);advance(s,CAST_DURATION+.2);
  const start=s.state.distance;assert.equal(s.applyPlayerMovement(100),.5);assert.equal(s.state.distance,start+.5);
  for(const delta of [NaN,Infinity,-Infinity])assert.equal(s.applyPlayerMovement(delta),0);
  for(let i=0;i<100;i++)s.applyPlayerMovement(.5);
  const limit=s.state.castDistance+12*s.state.setup.lineStrength;
  assert.equal(s.state.distance,limit);assert.equal(s.state.cue,'ease-line');assert.equal(s.applyPlayerMovement(.5),0);
  for(let i=0;i<100;i++)s.applyPlayerMovement(-.5);
  assert.equal(s.state.distance,.7);assert.equal(s.applyPlayerMovement(-.5),0);
  s.retrieve();s.cast();advance(s,CAST_DURATION+6.1);assert.equal(s.state.phase,'bite');
  const before=s.state.distance;assert.ok(Math.abs(s.applyPlayerMovement(.2)-.2)<1e-8);assert.ok(s.state.distance>before);
  s.hook();land(s);const landed=s.state.distance;assert.equal(s.applyPlayerMovement(1),0);assert.equal(s.state.distance,landed);
});
