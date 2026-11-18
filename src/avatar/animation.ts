import * as THREE from 'three';
export type CharacterModelKey = 'female' | 'male';

export type MotionName = 'idle' | 'walk' | 'run';
export type TransitionName = 'walkStart' | 'walkStop' | 'runStart' | 'runStop' | 'jumpStart' | 'jumpLoop' | 'jumpLand';
type ClipName = MotionName | TransitionName;
export interface CharacterClip {
  clip: THREE.AnimationClip; nominalSpeed: number; loop?: boolean;
  /** Normalized source time of the left heel strike. */
  contactPhase?: number;
  /** Normalized source takeoff time; physics has already left the floor. */
  launchPhase?: number;
  /** Optional original-speed excerpt before crossing into the following state. */
  playWindowSeconds?: number;
}
export type CharacterMotionLibrary = Record<MotionName, CharacterClip> & Partial<Record<TransitionName, CharacterClip>> & {
  /** Offline-measured rabbit pose-blend compensation, metres on the visual group only. */
  idleWalkBlendLiftM?: number;
};
export interface CharacterMotion {
  speed: number; distance?: number; sprinting: boolean; grounded?: boolean;
  acceleration?: number; verticalSpeed?: number; landingSpeed?: number;
}
interface MotionBundle {
  version: number; idleWalkBlendLiftM?: unknown;
  clips: Array<{ name: string; nominalSpeed: number; loop?: boolean; contactPhase?: number; launchPhase?: number; playWindowSeconds?: number;
    clip: Parameters<typeof THREE.AnimationClip.parse>[0] }>;
}
const REQUIRED: MotionName[] = ['idle', 'walk', 'run'];
const OPTIONAL: TransitionName[] = ['walkStart', 'walkStop', 'runStart', 'runStop', 'jumpStart', 'jumpLoop', 'jumpLand'];
const wrap = (value: number) => THREE.MathUtils.euclideanModulo(value, 1);
const damp = (current: number, target: number, response: number, dt: number) => target + (current - target) * Math.exp(-response * dt);
const smooth = THREE.MathUtils.smoothstep;
interface FootSample { phase: number; left: THREE.Vector3; right: THREE.Vector3 }
const sampledFeet = new WeakMap<CharacterMotionLibrary, Map<ClipName, FootSample[]>>();

/** Sample each delivered body once; all avatars sharing its library reuse this.
 * Entry/exit matching follows the CC0 Patch starter animator's foot-space idea. */
function measureFeet(root: THREE.Object3D, library: CharacterMotionLibrary) {
  const cached = sampledFeet.get(library); if (cached) return cached;
  const result = new Map<ClipName, FootSample[]>();
  const left = root.getObjectByName('foot_l'), right = root.getObjectByName('foot_r');
  if (!left || !right) { sampledFeet.set(library, result); return result; }
  const rest: Array<{ object: THREE.Object3D; position: THREE.Vector3; rotation: THREE.Quaternion }> = [];
  root.traverse(object => { if (object instanceof THREE.Bone) rest.push({ object, position: object.position.clone(), rotation: object.quaternion.clone() }); });
  const mixer = new THREE.AnimationMixer(root);
  const local = (bone: THREE.Object3D) => root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
  for (const name of [...REQUIRED, ...OPTIONAL]) {
    const entry = library[name]; if (!entry) continue;
    const action = mixer.clipAction(entry.clip).setLoop(THREE.LoopOnce, 1).play(); action.clampWhenFinished = true;
    const samples: FootSample[] = [];
    for (let frame = 0; frame <= 30; frame++) {
      action.time = frame / 30 * entry.clip.duration; mixer.update(0); root.updateWorldMatrix(true, true);
      samples.push({ phase: frame / 30, left: local(left), right: local(right) });
    }
    result.set(name, samples); action.stop();
  }
  mixer.stopAllAction(); mixer.uncacheRoot(root);
  for (const pose of rest) { pose.object.position.copy(pose.position); pose.object.quaternion.copy(pose.rotation); }
  root.updateWorldMatrix(true, true); sampledFeet.set(library, result); return result;
}

export async function loadCharacterMotionLibrary(bodyType: CharacterModelKey): Promise<CharacterMotionLibrary> {
  const response = await fetch(`/characters/${bodyType}-motions.json`);
  if (!response.ok) throw new Error(`Character animations: ${response.status}`);
  const bundle = await response.json() as MotionBundle;
  if (bundle.version !== 1 || !Array.isArray(bundle.clips)) throw new Error('Unsupported character animation library');
  const library = {} as CharacterMotionLibrary;
  for (const name of [...REQUIRED, ...OPTIONAL]) {
    const entry = bundle.clips.find(candidate => candidate.name === name);
    if (!entry && OPTIONAL.includes(name as TransitionName)) continue;
    if (!entry || !Number.isFinite(entry.nominalSpeed) || entry.nominalSpeed < 0
      || (name === 'walk' || name === 'run') && entry.nominalSpeed <= 0) throw new Error(`Missing character animation: ${name}`);
    if ([entry.contactPhase, entry.launchPhase].some(value => value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1))) {
      throw new Error(`Invalid character phase: ${name}`);
    }
    // Offline bundles omit IDs; undefined IDs would alias different mixer actions.
    const clip = THREE.AnimationClip.parse({ ...entry.clip, uuid: THREE.MathUtils.generateUUID() });
    if (!(clip.duration > 0) || !clip.tracks.length || !clip.validate()) throw new Error(`Invalid character animation: ${name}`);
    if (entry.playWindowSeconds !== undefined && (!Number.isFinite(entry.playWindowSeconds) || entry.playWindowSeconds <= 0 || entry.playWindowSeconds > clip.duration)) throw new Error(`Invalid character window: ${name}`);
    library[name] = { clip, nominalSpeed: entry.nominalSpeed, loop: entry.loop, contactPhase: entry.contactPhase,
      launchPhase: entry.launchPhase, playWindowSeconds: entry.playWindowSeconds };
  }
  return library;
}

/** Distance-synchronized gait and interruptible authored starts, stops and jumps.
 * The controller owns movement throughout every animation. */
export function createCharacterAnimation(root: THREE.Object3D, library: CharacterMotionLibrary) {
  const blendLift = library.idleWalkBlendLiftM ?? 0;
  const samples = measureFeet(root, library);
  const mixer = new THREE.AnimationMixer(root);
  const names = [...REQUIRED, ...OPTIONAL.filter(name => library[name])];
  const actions = new Map<ClipName, THREE.AnimationAction>(), weights = new Map<ClipName, number>();
  for (const name of names) {
    const entry = library[name]!;
    const loop = entry.loop ?? (REQUIRED.includes(name as MotionName) || name === 'jumpLoop');
    const action = mixer.clipAction(entry.clip).setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1).play();
    action.clampWhenFinished = !loop; action.setEffectiveWeight(name === 'idle' ? 1 : 0);
    actions.set(name, action); weights.set(name, name === 'idle' ? 1 : 0);
  }
  let phase = 0, idleTime = 0, moving = 0, running = 0;
  let previousSpeed = 0, peakSpeed = 0, quietTime = 1, wasGrounded = true;
  let transition: { name: TransitionName; time: number; rate: number; elapsed: number; duration: number; strength: number } | undefined;
  function match(name: ClipName, from = 0, to = 1) {
    const left = root.getObjectByName('foot_l'), right = root.getObjectByName('foot_r'), poses = samples.get(name);
    if (!left || !right || !poses) return from;
    root.updateWorldMatrix(true, true);
    const l = root.worldToLocal(left.getWorldPosition(new THREE.Vector3())), r = root.worldToLocal(right.getWorldPosition(new THREE.Vector3()));
    let best = from, error = Infinity;
    for (const pose of poses) {
      if (pose.phase < from || pose.phase > to) continue;
      const distance = pose.left.distanceToSquared(l) + pose.right.distanceToSquared(r);
      if (distance < error) { error = distance; best = pose.phase; }
    }
    return best;
  }
  function resumeGait(speed: number) {
    const name = speed > 2.4 ? 'run' : 'walk'; phase = wrap(match(name) - (library[name].contactPhase ?? 0));
  }
  function enter(name: TransitionName, duration: number, from = 0, strength = 1) {
    const entry = library[name]; if (!entry) return;
    if (name === 'walkStart' || name === 'runStart') {
      from = match(name, 0, .3); duration = entry.clip.duration * (1 - from);
    } else if (name === 'walkStop' || name === 'runStop') {
      from = match(name, .35, .85); duration = entry.clip.duration * (1 - from);
    }
    transition = { name, time: from * entry.clip.duration, rate: 1, elapsed: 0,
      duration: entry.playWindowSeconds ?? duration, strength };
  }
  const capture = () => ({ phase, idleTime, moving, running, previousSpeed, peakSpeed, quietTime, wasGrounded,
    transition: transition ? {...transition} : undefined, weights: Object.fromEntries(weights),
    times: Object.fromEntries([...actions].map(([name, action]) => [name, action.time])), lift: root.position.y });
  return {
    capture,
    restore(state: ReturnType<typeof capture>) {
      ({phase,idleTime,moving,running,previousSpeed,peakSpeed,quietTime,wasGrounded}=state);
      transition=state.transition?{...state.transition}:undefined;
      for(const [name,action] of actions){const weight=state.weights[name]??0;weights.set(name,weight);action.setEffectiveWeight(weight);action.time=state.times[name]??0;}
      mixer.update(0);root.position.y=state.lift;
    },
    has(name: TransitionName) { return !!library[name]; },
    update(dt: number, motion: CharacterMotion) {
      dt = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, .1) : 0;
      const speed = Number.isFinite(motion.speed) ? Math.max(0, motion.speed) : 0;
      const grounded = motion.grounded !== false;
      const vertical = Number.isFinite(motion.verticalSpeed) ? motion.verticalSpeed! : 0;
      const acceleration = Number.isFinite(motion.acceleration) ? motion.acceleration! : dt > 0 ? (speed - previousSpeed) / dt : 0;
      const wasQuiet = quietTime > .15;
      quietTime = grounded && speed < .08 ? quietTime + dt : 0;
      peakSpeed = speed > peakSpeed ? speed : quietTime > .4 ? 0 : peakSpeed;
      if (!grounded && wasGrounded) {
        transition = undefined;
        if (vertical > .1 && library.jumpStart) enter('jumpStart', THREE.MathUtils.clamp(library.jumpStart.clip.duration, .16, .26), library.jumpStart.launchPhase ?? .45);
      } else if (grounded && (!wasGrounded || (motion.landingSpeed ?? 0) > 1)) {
        transition = undefined;
        const impact = motion.landingSpeed ?? 3;
        if (impact > .6) enter('jumpLand', THREE.MathUtils.clamp(.18 + impact * .018, .2, .36), 0,
          THREE.MathUtils.lerp(.95, .55, smooth(speed, .3, 3)));
      } else if (grounded && wasQuiet && speed > .08 && acceleration >= 0) {
        enter(motion.sprinting && library.runStart ? 'runStart' : 'walkStart', motion.sprinting ? .42 : .34);
      } else if (grounded && previousSpeed >= .85 && speed < .85 && acceleration < -.6) {
        enter(peakSpeed > 2.4 && library.runStop ? 'runStop' : 'walkStop', peakSpeed > 2.4 ? .32 : .26);
      }
      if (transition && /Stop$/.test(transition.name) && acceleration > 1 && speed > .3) { resumeGait(speed); transition = undefined; }
      if (!grounded && transition && !transition.name.startsWith('jump')) transition = undefined;
      if (transition) {
        transition.elapsed += dt;
        const entry = library[transition.name]!;
        const starting = transition.name === 'walkStart' || transition.name === 'runStart';
        const advance = starting ? Math.max(0, motion.distance ?? speed * dt) / Math.max(.1, entry.nominalSpeed) : dt * transition.rate;
        transition.time = Math.min(entry.clip.duration, transition.time + advance);
        if (transition.time >= entry.clip.duration || !starting && transition.elapsed >= transition.duration
          || starting && (speed < .03 || transition.elapsed > 1)) {
          resumeGait(speed); transition = undefined;
        }
      }
      // Shift expresses intent, not the gait of a body still travelling quickly.
      moving = damp(moving, grounded ? smooth(speed, .025, .7) : 0, speed > .03 ? 12 : 16, dt);
      running = damp(running, smooth(speed, 1.5, 4.8), 10, dt);
      const stride = THREE.MathUtils.lerp(library.walk.nominalSpeed * library.walk.clip.duration,
        library.run.nominalSpeed * library.run.clip.duration, running);
      const distance = dt > 0 && grounded
        ? motion.distance === undefined ? speed * dt : Number.isFinite(motion.distance) ? Math.max(0, motion.distance) : 0 : 0;
      phase = wrap(phase + distance / Math.max(.05, stride)); idleTime += dt;
      actions.get('idle')!.time = idleTime % library.idle.clip.duration;
      for (const name of ['walk', 'run'] as const) actions.get(name)!.time = wrap(phase + (library[name].contactPhase ?? 0)) * library[name].clip.duration;
      const wanted = new Map<ClipName, number>([['idle', 1 - moving], ['walk', moving * (1 - running)], ['run', moving * running]]);
      if (!grounded && !transition && library.jumpLoop) {
        actions.get('jumpLoop')!.time = idleTime % library.jumpLoop.clip.duration; wanted.clear(); wanted.set('jumpLoop', 1);
      }
      if (transition) {
        for (const [name, value] of wanted) wanted.set(name, value * (1 - transition.strength));
        wanted.set(transition.name, transition.strength); actions.get(transition.name)!.time = transition.time;
      }
      // Outgoing poses fade without passing through bind pose or restarting a knee.
      let total = 0;
      for (const name of names) {
        const weight = damp(weights.get(name)!, wanted.get(name) ?? 0, 18, dt); weights.set(name, weight); total += weight;
      }
      for (const name of names) actions.get(name)!.setEffectiveWeight(weights.get(name)! / Math.max(total, 1e-9));
      mixer.update(0);
      if (blendLift > 0) {
        const blendedMoving = (weights.get('walk')! + weights.get('run')!) / total;
        const blendedRunning = weights.get('run')! / Math.max(1e-9, weights.get('walk')! + weights.get('run')!);
        root.position.y = Math.min(.05, 4 * blendedMoving * (1 - blendedMoving) * blendLift * (1 + blendedRunning * (1 - blendedMoving)));
      }
      previousSpeed = speed; wasGrounded = grounded;
    },
    snapshot() { return { phase, moving, running, transition: transition?.name ?? null, weights: Object.fromEntries(weights) }; },
    reset() {
      mixer.stopAllAction(); moving = running = previousSpeed = peakSpeed = 0; quietTime = 1; wasGrounded = true; transition = undefined;
      for (const [name, action] of actions) {
        action.reset().play(); action.setEffectiveWeight(name === 'idle' ? 1 : 0); weights.set(name, name === 'idle' ? 1 : 0);
      }
      if (blendLift > 0) root.position.y = 0;
    },
    stop() { mixer.stopAllAction(); mixer.uncacheRoot(root); if (blendLift > 0) root.position.y = 0; },
  };
}
