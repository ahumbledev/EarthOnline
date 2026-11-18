import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsAttachment } from '../exploration/player.ts';
import type { Box3, HomeItemSize, HomePhysicsShape } from './state.ts';

/** Loose props beyond this stay in the inventory; sleeping bodies still count. */
export const MAX_DYNAMIC_PROPS = 60;
/** A body quiet for this long is reported settled even before Rapier sleeps it. */
const SETTLE_SECONDS = .5;
const SETTLE_SPEED = .02, SETTLE_SPIN = .05;
const IMPACT_DROP = .7;
/** A grabbed prop closes this share of the gap to the hand per second, and never moves faster than GRAB_SPEED. */
const GRAB_PULL = 16, GRAB_SPEED = 6, GRAB_TURN = 12, GRAB_SPIN = 9;
/** Letting go keeps some of the swing, but a prop is set down, not thrown. */
const RELEASE_SPEED = 2.5;

export interface PropShape {
  shape: HomePhysicsShape | undefined;
  size: HomeItemSize;
  center?: { x: number; z: number };
  /** Compound solids in model coordinates; cavities remain empty. */
  blocks?: readonly Box3[];
}
export interface StaticPropOptions extends PropShape {
  id: string;
  position: THREE.Vector3;
  yaw: number;
  quaternion?: THREE.Quaternion;
  mass?: number;
  /** Solid boxes in the item's own frame that replace the single shape: boards and panels of a shelf unit, bays left open. */
  blocks?: readonly Box3[];
}
export interface DynamicPropOptions extends PropShape {
  id: string;
  mass: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Furniture remains an obstacle to the character and is not hand-grabbable. */
  furniture?: boolean;
}
export interface DynamicProp {
  readonly id: string;
  readonly furniture: boolean;
  /** Live physics pose of the model origin (its base centre when upright). */
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  /** Pose blended between fixed steps for drawing. */
  readonly renderPosition: THREE.Vector3;
  readonly renderQuaternion: THREE.Quaternion;
  readonly sleeping: boolean;
  /** Quiet long enough for its pose to be saved. */
  readonly settled: boolean;
  readonly held: boolean;
  readonly speed: number;
  readonly disposed: boolean;
}
export interface PropImpact { id: string; speed: number; position: THREE.Vector3 }
export type SupportHit = { kind: 'static' | 'dynamic'; id: string } | { kind: 'environment' };
export interface PropPose extends PropShape { id?: string; position: THREE.Vector3; quaternion: THREE.Quaternion }

interface InternalDynamic extends DynamicProp {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  colliders: RAPIER.Collider[];
  previousPosition: THREE.Vector3;
  previousQuaternion: THREE.Quaternion;
  quietTime: number;
  settled: boolean;
  held: boolean;
  previousSpeed: number;
}
interface InternalStatic { id: string; body: RAPIER.RigidBody; colliders: RAPIER.Collider[] }

const UP = new THREE.Vector3(0, 1, 0);
const finite = (vector: { x: number; y: number; z: number }) => Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
const positive = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
const validRotation = (rotation: THREE.Quaternion) => Number.isFinite(rotation.lengthSq()) && rotation.lengthSq() > 1e-6;
const CONTACT_MARGIN = .012;
const PENETRATION_TOLERANCE = .003;

/** Hull points are stored relative to the model origin; shift them by an offset. */
function hullDescription(points: readonly number[], offsetY = 0): RAPIER.ColliderDesc | undefined {
  if (points.length < 12 || points.length % 3 !== 0 || points.length > 3 * 256 || !points.every(Number.isFinite)) return;
  const data = new Float32Array(points.length);
  for (let index = 0; index < points.length; index++) data[index] = points[index] + (index % 3 === 1 ? offsetY : 0);
  return RAPIER.ColliderDesc.convexHull(data) ?? undefined;
}

/** Collider for an item's shape with its base at the body origin. */
export function describeCollider(options: PropShape, rounded: boolean): RAPIER.ColliderDesc {
  const { size } = options;
  const cx = options.center?.x ?? 0, cz = options.center?.z ?? 0;
  if (!positive(size.width, .01, 8) || !positive(size.depth, .01, 8) || !positive(size.height, .005, 4)) throw new Error('Invalid prop size.');
  const kind = options.shape?.kind ?? 'box';
  const border = rounded ? Math.min(.006, size.width / 8, size.depth / 8, size.height / 8) : 0;
  if (kind === 'hull' && options.shape?.kind === 'hull') {
    const hull = hullDescription(options.shape.points);
    if (hull) return hull;
  }
  if (kind === 'ball') {
    const radius = Math.max(size.width, size.depth, size.height) / 2;
    return RAPIER.ColliderDesc.ball(radius).setTranslation(cx, radius, cz);
  }
  if (kind === 'cylinder') {
    const radius = Math.min(size.width, size.depth) / 2;
    const halfHeight = size.height / 2;
    const desc = border > 0
      ? RAPIER.ColliderDesc.roundCylinder(halfHeight - border, radius - border, border)
      : RAPIER.ColliderDesc.cylinder(halfHeight, radius);
    return desc.setTranslation(cx, halfHeight, cz);
  }
  const hx = size.width / 2, hy = size.height / 2, hz = size.depth / 2;
  const desc = border > 0 ? RAPIER.ColliderDesc.roundCuboid(hx - border, hy - border, hz - border, border) : RAPIER.ColliderDesc.cuboid(hx, hy, hz);
  return desc.setTranslation(cx, hy, cz);
}

/** The same solids are used by simulation and placement queries. */
export function describeColliders(options: PropShape, rounded = false): RAPIER.ColliderDesc[] {
  if (!options.blocks?.length) return [describeCollider(options, rounded)];
  if (options.blocks.length > 128 || options.blocks.some(block => !block.min.every(Number.isFinite) || !block.max.every(Number.isFinite)
    || block.max.some((value, axis) => value - block.min[axis] < .002))) throw new Error('Invalid compound prop shape.');
  return options.blocks.map(block => RAPIER.ColliderDesc.cuboid((block.max[0] - block.min[0]) / 2, (block.max[1] - block.min[1]) / 2, (block.max[2] - block.min[2]) / 2)
    .setTranslation((block.min[0] + block.max[0]) / 2, (block.min[1] + block.max[1]) / 2, (block.min[2] + block.max[2]) / 2));
}

function colliderMasses(options: PropShape, total: number, count: number): number[] {
  if (!options.blocks?.length) return [total];
  const volumes = options.blocks.map(block => block.max.reduce((volume, value, axis) => volume * (value - block.min[axis]), 1));
  const volume = volumes.reduce((sum, value) => sum + value, 0);
  return volumes.slice(0, count).map(value => total * value / volume);
}

/**
 * Furniture is fixed and loose props are dynamic in the character's own world.
 * The controller steps the world; this attachment only owns its bodies.
 */
export function createHomePropPhysics(world: RAPIER.World, playerCollider: RAPIER.Collider) {
  const statics = new Map<string, InternalStatic>();
  const dynamics = new Map<string, InternalDynamic>();
  const dynamicHandles = new Set<number>();
  const owners = new Map<number, string>();
  const impacts: PropImpact[] = [];
  const settledListeners = new Set<(id: string) => void>();
  const gravityScale = 9.81 / Math.max(.01, Math.abs(world.gravity.y));
  const yawRotation = new THREE.Quaternion();
  const contactPoint = new THREE.Vector3();
  let disposed = false;
  /** The prop in the resident's hand: a real body pulled toward a point, colliding with everything on the way. */
  let grab: { prop: InternalDynamic; anchor: THREE.Vector3; target: THREE.Vector3; yaw: number } | undefined;
  const anchorWorld = new THREE.Vector3(), pull = new THREE.Vector3(), wanted = new THREE.Quaternion(), error = new THREE.Quaternion(), current = new THREE.Quaternion();
  const driveGrab = () => {
    if (!grab) return;
    const { prop } = grab;
    prop.body.wakeUp();
    current.copy(prop.body.rotation());
    anchorWorld.copy(grab.anchor).applyQuaternion(current).add(prop.body.translation());
    pull.subVectors(grab.target, anchorWorld).multiplyScalar(GRAB_PULL);
    if (pull.length() > GRAB_SPEED) pull.setLength(GRAB_SPEED);
    prop.body.setLinvel(pull, true);
    // The hand holds things upright at the heading it was given.
    wanted.setFromAxisAngle(UP, grab.yaw);
    error.copy(wanted).multiply(current.invert());
    if (error.w < 0) error.set(-error.x, -error.y, -error.z, -error.w);
    const sine = Math.hypot(error.x, error.y, error.z);
    if (sine < 1e-5) prop.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    else {
      const rate = Math.min(GRAB_SPIN, 2 * Math.atan2(sine, error.w) * GRAB_TURN) / sine;
      prop.body.setAngvel({ x: error.x * rate, y: error.y * rate, z: error.z * rate }, true);
    }
  };

  const supportsOf = (id: string): SupportHit[] => {
    const prop = dynamics.get(id);
    if (disposed || !prop || prop.held) return [];
    const hits = new Map<string, SupportHit>();
    for (const collider of prop.colliders) world.forEachCollider(other => {
      if (!other.isEnabled() || other.isSensor() || other.handle === playerCollider.handle || owners.get(other.handle) === id) return;
      const contact = collider.contactCollider(other, CONTACT_MARGIN);
      // The supporting face points up toward this body. A nearby wall or a table
      // below an airborne item is not a support, even when their footprints overlap.
      if (!contact || contact.distance > CONTACT_MARGIN || contact.normal1.y > -.5) return;
      const owner = owners.get(other.handle);
      hits.set(owner ?? 'environment', owner ? { kind: dynamics.has(owner) ? 'dynamic' : 'static', id: owner } : { kind: 'environment' });
    });
    return [...hits.values()];
  };
  const supportedBy = (id: string, recursive = true): string[] => {
    const graph = new Map<string, string[]>();
    for (const prop of dynamics.values()) for (const support of supportsOf(prop.id)) {
      if (support.kind === 'environment') continue;
      const children = graph.get(support.id) ?? []; children.push(prop.id); graph.set(support.id, children);
    }
    const visited = new Set<string>([id]), result: string[] = [], pending = [id];
    while (pending.length) for (const child of graph.get(pending.shift()!) ?? []) {
      if (visited.has(child)) continue;
      visited.add(child); result.push(child); if (recursive) pending.push(child);
    }
    return result;
  };
  const wake = (ids: Iterable<string>) => {
    for (const id of ids) {
      const prop = dynamics.get(id);
      if (!prop || prop.held) continue;
      prop.body.wakeUp(); prop.quietTime = 0; prop.settled = false;
    }
  };
  const touching = (colliders: readonly RAPIER.Collider[]): string[] => {
    const result = new Set<string>();
    for (const prop of dynamics.values()) {
      if (prop.held || colliders.some(collider => owners.get(collider.handle) === prop.id)) continue;
      if (prop.colliders.some(other => colliders.some(collider => !!collider.contactCollider(other, CONTACT_MARGIN)))) result.add(prop.id);
    }
    return [...result];
  };
  const trackDynamic = (id: string, body: RAPIER.RigidBody, colliders: RAPIER.Collider[], furniture: boolean): InternalDynamic => {
    const position = new THREE.Vector3().copy(body.translation()), quaternion = new THREE.Quaternion().copy(body.rotation());
    const prop: InternalDynamic = {
      id, furniture, body, collider: colliders[0], colliders, position, quaternion,
      renderPosition: position.clone(), renderQuaternion: quaternion.clone(),
      previousPosition: position.clone(), previousQuaternion: quaternion.clone(),
      quietTime: 0, settled: false, held: false, previousSpeed: 0,
      get sleeping() { return this.disposed || body.isSleeping(); },
      get speed() { if (this.disposed) return 0; const velocity = body.linvel(); return Math.hypot(velocity.x, velocity.y, velocity.z); },
      get disposed() { return dynamics.get(this.id) !== this; },
    };
    dynamics.set(id, prop);
    for (const collider of colliders) { owners.set(collider.handle, id); if (!furniture) dynamicHandles.add(collider.handle); }
    return prop;
  };

  const attachment: PhysicsAttachment = {
    passable: collider => dynamicHandles.has(collider.handle),
    afterStep(dt) {
      for (const prop of dynamics.values()) {
        if (prop.held) continue;
        prop.previousPosition.copy(prop.position); prop.previousQuaternion.copy(prop.quaternion);
        prop.position.copy(prop.body.translation()); prop.quaternion.copy(prop.body.rotation());
        const velocity = prop.body.linvel(), spin = prop.body.angvel();
        const speed = Math.hypot(velocity.x, velocity.y, velocity.z), angular = Math.hypot(spin.x, spin.y, spin.z);
        // A sharp loss of speed against another solid is an impact: the view may play a clink.
        if (prop.previousSpeed - speed > IMPACT_DROP && impacts.length < 16) {
          let touching = false;
          for (const collider of prop.colliders) world.contactPairsWith(collider, other => {
            if (touching || other.isSensor()) return;
            const contact = collider.contactCollider(other, .01);
            if (contact && contact.distance < .01) { touching = true; contactPoint.copy(contact.point1); }
          });
          if (touching) impacts.push({ id: prop.id, speed: prop.previousSpeed, position: contactPoint.clone() });
        }
        prop.previousSpeed = speed;
        const quiet = speed < SETTLE_SPEED && angular < SETTLE_SPIN;
        prop.quietTime = quiet ? prop.quietTime + dt : 0;
        if (grab?.prop === prop) prop.quietTime = 0;
        const settled = grab?.prop !== prop && (prop.body.isSleeping() || prop.quietTime >= SETTLE_SECONDS);
        if (settled && !prop.settled) { prop.settled = true; for (const listener of settledListeners) listener(prop.id); }
        else if (!settled) prop.settled = false;
      }
      driveGrab();
    },
    interpolate(alpha) {
      const t = THREE.MathUtils.clamp(alpha, 0, 1);
      for (const prop of dynamics.values()) {
        prop.renderPosition.lerpVectors(prop.previousPosition, prop.position, t);
        prop.renderQuaternion.slerpQuaternions(prop.previousQuaternion, prop.quaternion, t);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      grab = undefined;
      for (const prop of dynamics.values()) world.removeRigidBody(prop.body);
      for (const item of statics.values()) world.removeRigidBody(item.body);
      dynamics.clear(); statics.clear(); dynamicHandles.clear(); owners.clear(); settledListeners.clear();
    },
  };

  const system = {
    ...attachment,
    get disposed() { return disposed; },
    get dynamicCount() { return [...dynamics.values()].filter(prop => !prop.furniture).length; },
    /** Furniture the character and loose props collide with. Yaw is about +Y at the item's origin. */
    addStatic(options: StaticPropOptions, wakeNearby = true) {
      if (disposed) throw new Error('Home physics is disposed.');
      if (!options.id || statics.has(options.id) || dynamics.has(options.id)) throw new Error('Prop ID must be nonempty and unique.');
      if (!finite(options.position) || !Number.isFinite(options.yaw) || options.quaternion && !validRotation(options.quaternion)) throw new Error('Invalid prop pose.');
      const mass = options.mass ?? 40;
      if (!positive(mass, .02, 1000)) throw new Error('Invalid prop mass.');
      if (options.quaternion) yawRotation.copy(options.quaternion).normalize(); else yawRotation.setFromAxisAngle(UP, options.yaw);
      const descriptions = describeColliders(options);
      const masses = colliderMasses(options, mass, descriptions.length);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(options.position.x, options.position.y, options.position.z).setRotation(yawRotation));
      const colliders = descriptions.map((description, index) => world.createCollider(description.setMass(masses[index]).setFriction(.75).setRestitution(.05), body));
      statics.set(options.id, { id: options.id, body, colliders });
      for (const collider of colliders) owners.set(collider.handle, options.id);
      if (wakeNearby) wake(touching(colliders));
    },
    moveStatic(id: string, position: THREE.Vector3, yaw: number): boolean {
      const item = statics.get(id);
      if (disposed || !item || !finite(position) || !Number.isFinite(yaw)) return false;
      const affected = supportedBy(id);
      yawRotation.setFromAxisAngle(UP, yaw);
      item.body.setTranslation(position, true); item.body.setRotation(yawRotation, true);
      world.propagateModifiedBodyPositionsToColliders();
      wake([...affected, ...touching(item.colliders)]);
      return true;
    },
    removeStatic(id: string): boolean {
      const item = statics.get(id);
      if (disposed || !item) return false;
      const affected = supportedBy(id);
      for (const collider of item.colliders) owners.delete(collider.handle);
      world.removeRigidBody(item.body); statics.delete(id);
      wake(affected);
      return true;
    },
    hasStatic: (id: string) => statics.has(id),
    /** A loose prop with mass. Its base rests at the pose origin when upright. */
    addDynamic(options: DynamicPropOptions): DynamicProp {
      if (disposed) throw new Error('Home physics is disposed.');
      if (!options.id || dynamics.has(options.id) || statics.has(options.id)) throw new Error('Prop ID must be nonempty and unique.');
      if (!options.furniture && system.dynamicCount >= MAX_DYNAMIC_PROPS) throw new Error('Too many loose props.');
      if (!finite(options.position) || !validRotation(options.quaternion)) throw new Error('Invalid prop pose.');
      if (!positive(options.mass, .02, options.furniture ? 1000 : 40)) throw new Error('Invalid prop mass.');
      const descriptions = describeColliders(options, !options.furniture);
      const masses = colliderMasses(options, options.mass, descriptions.length);
      const rotation = options.quaternion.clone().normalize();
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(options.position.x, options.position.y, options.position.z).setRotation(rotation)
        .setGravityScale(gravityScale).setCcdEnabled(true).setSoftCcdPrediction(.05)
        .setLinearDamping(.08).setAngularDamping(.25).setCanSleep(true));
      const colliders = descriptions.map((description, index) => world.createCollider(description.setMass(masses[index]).setFriction(.7).setRestitution(options.furniture ? .05 : .12), body));
      const prop = trackDynamic(options.id, body, colliders, !!options.furniture);
      // Props always start awake, restored saves included. A body put to sleep before its first step has no
      // contacts yet: it wakes anyway, sinks into its support and is pushed out somewhere else. Awake at a
      // resting pose it stays exactly there and falls asleep by itself.
      return prop;
    },
    getDynamic: (id: string): DynamicProp | undefined => dynamics.get(id),
    /** A gameplay impulse releases furniture into ordinary gravity, retaining every cabinet board. */
    activateFurniture(id: string, impulse: THREE.Vector3, worldPoint?: THREE.Vector3): DynamicProp | undefined {
      if (disposed || !finite(impulse) || worldPoint && !finite(worldPoint)) return;
      let prop = dynamics.get(id);
      if (prop && (!prop.furniture || prop.held)) return;
      const affected = supportedBy(id);
      if (!prop) {
        const item = statics.get(id);
        if (!item) return;
        item.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        item.body.setGravityScale(gravityScale, true);
        item.body.enableCcd(true); item.body.setLinearDamping(.08); item.body.setAngularDamping(.25);
        statics.delete(id);
        prop = trackDynamic(id, item.body, item.colliders, true);
      }
      wake([id, ...affected]);
      if (worldPoint) prop.body.applyImpulseAtPoint(impulse, worldPoint, true); else prop.body.applyImpulse(impulse, true);
      return prop;
    },
    removeDynamic(id: string): boolean {
      const prop = dynamics.get(id);
      if (disposed || !prop) return false;
      const affected = supportedBy(id);
      if (grab?.prop === prop) grab = undefined;
      for (const collider of prop.colliders) { dynamicHandles.delete(collider.handle); owners.delete(collider.handle); }
      world.removeRigidBody(prop.body); dynamics.delete(id);
      wake(affected);
      return true;
    },
    /**
     * Take a prop in the hand at a point on it. It stays a colliding body: gravity lets go of it and it is pulled
     * toward the drag target, bumping into shelves and shoving other things aside on the way.
     */
    grab(id: string, point: THREE.Vector3): boolean {
      const prop = dynamics.get(id);
      if (disposed || !prop || prop.furniture || prop.held || !finite(point)) return false;
      if (grab) system.drop();
      current.copy(prop.body.rotation());
      const anchor = point.clone().sub(prop.body.translation()).applyQuaternion(current.clone().invert());
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(current);
      grab = { prop, anchor, target: point.clone(), yaw: Math.atan2(forward.x, forward.z) };
      prop.body.setGravityScale(0, true); prop.settled = false; prop.quietTime = 0;
      return true;
    },
    /** Where the hand wants the grabbed point to be; `turn` adds to the heading the prop is held at. */
    dragTo(target: THREE.Vector3, turn = 0) {
      if (!grab || !finite(target) || !Number.isFinite(turn)) return;
      grab.target.copy(target); grab.yaw += turn;
    },
    /** Let go: gravity takes the prop back and it settles where it is. */
    drop(): string | undefined {
      if (!grab) return;
      const { prop } = grab; grab = undefined;
      if (disposed || prop.disposed) return;
      prop.body.setGravityScale(gravityScale, true);
      const velocity = prop.body.linvel(), speed = Math.hypot(velocity.x, velocity.y, velocity.z);
      if (speed > RELEASE_SPEED) prop.body.setLinvel({ x: velocity.x / speed * RELEASE_SPEED, y: velocity.y / speed * RELEASE_SPEED, z: velocity.z / speed * RELEASE_SPEED }, true);
      prop.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      prop.quietTime = 0; prop.settled = false;
      return prop.id;
    },
    get grabbed(): string | undefined { return grab?.prop.id; },
    /** Lift a prop out of the simulation while it is being carried by the cursor. */
    hold(id: string): boolean {
      const prop = dynamics.get(id);
      if (disposed || !prop || prop.held) return false;
      prop.held = true; prop.body.setEnabled(false);
      return true;
    },
    /** Put a held prop back at a pose with no velocity; it settles from there, and on a clear level spot stays exactly where it was set. */
    release(id: string, position: THREE.Vector3, quaternion: THREE.Quaternion): boolean {
      const prop = dynamics.get(id);
      if (disposed || !prop || !finite(position) || !validRotation(quaternion)) return false;
      const rotation = quaternion.clone().normalize();
      prop.body.setEnabled(true);
      prop.body.setTranslation(position, true); prop.body.setRotation(rotation, true);
      prop.body.setLinvel({ x: 0, y: 0, z: 0 }, true); prop.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      world.propagateModifiedBodyPositionsToColliders();
      prop.held = false; prop.quietTime = 0; prop.settled = false; prop.previousSpeed = 0;
      prop.position.copy(position); prop.quaternion.copy(rotation);
      prop.previousPosition.copy(position); prop.previousQuaternion.copy(rotation);
      prop.renderPosition.copy(position); prop.renderQuaternion.copy(rotation);
      prop.body.wakeUp();
      return true;
    },
    /** Furniture carried a prop: move it with the same rigid transform and let it resettle. */
    teleportDynamic(id: string, position: THREE.Vector3, quaternion: THREE.Quaternion): boolean {
      const prop = dynamics.get(id);
      if (disposed || !prop || prop.held) return false;
      return system.release(id, position, quaternion);
    },
    supportsOf,
    supportedBy,
    /** Only actual supporting contacts count, including other loose props. */
    supportOf(id: string, _reach?: number): SupportHit | undefined { return supportsOf(id)[0]; },
    poseBlocked(options: PropShape, position: THREE.Vector3, quaternion: THREE.Quaternion, ignore?: string | readonly string[]): boolean {
      return system.groupBlocked([{ ...options, position, quaternion }], typeof ignore === 'string' ? [ignore] : ignore);
    },
    /** Validate every solid in a proposed group, against the world and the other proposed members. */
    groupBlocked(candidates: readonly PropPose[], ignore: readonly string[] = []): boolean {
      if (disposed) return true;
      const ignored = new Set(ignore);
      for (const candidate of candidates) if (candidate.id) ignored.add(candidate.id);
      const shapes: { member: number; shape: RAPIER.Shape; position: THREE.Vector3; rotation: THREE.Quaternion }[] = [];
      try {
        candidates.forEach((candidate, member) => {
          if (!finite(candidate.position) || !validRotation(candidate.quaternion)) throw new Error('Invalid pose.');
          const rotation = candidate.quaternion.clone().normalize();
          for (const desc of describeColliders(candidate, !candidate.blocks?.length)) shapes.push({ member, shape: desc.shape, rotation,
            position: new THREE.Vector3().copy(desc.translation).applyQuaternion(rotation).add(candidate.position) });
        });
      } catch { return true; }
      let blocked = false;
      for (let i = 0; i < shapes.length && !blocked; i++) {
        const candidate = shapes[i];
        world.forEachCollider(other => {
          if (blocked || !other.isEnabled() || other.isSensor() || other.handle === playerCollider.handle || ignored.has(owners.get(other.handle) ?? '')) return;
          const contact = other.contactShape(candidate.shape, candidate.position, candidate.rotation, 0);
          if (contact && contact.distance < -PENETRATION_TOLERANCE) blocked = true;
          // A small item may fit wholly inside a closed wall mesh, with no
          // intersecting triangles. Surface contacts alone miss that case.
          if (!blocked && other.containsPoint(candidate.position)) {
            const boundary = other.projectPoint(candidate.position, false);
            if (boundary && candidate.position.distanceTo(boundary.point) > PENETRATION_TOLERANCE) blocked = true;
          }
        });
        for (let j = 0; j < i && !blocked; j++) {
          const other = shapes[j];
          if (other.member === candidate.member) continue;
          const contact = candidate.shape.contactShape(candidate.position, candidate.rotation, other.shape, other.position, other.rotation, 0);
          if (contact && contact.distance < -PENETRATION_TOLERANCE) blocked = true;
          // GJK may report zero depth for coincident round shapes. Interior
          // centres distinguish that degenerate overlap from a touching face.
          for (const [outer, inner] of [[candidate, other], [other, candidate]]) {
            if (blocked || !outer.shape.containsPoint(outer.position, outer.rotation, inner.position)) continue;
            const boundary = outer.shape.projectPoint(outer.position, outer.rotation, inner.position, false);
            if (inner.position.distanceTo(boundary.point) > PENETRATION_TOLERANCE) blocked = true;
          }
        }
      }
      return blocked;
    },
    /** Distance to the first piece of furniture or wall along a ray, ignoring loose props and the resident. */
    solidAlong(origin: THREE.Vector3, direction: THREE.Vector3, reach: number): number | undefined {
      if (disposed || !finite(origin) || !finite(direction) || !(reach > 0)) return;
      const hit = world.castRay(new RAPIER.Ray(origin, direction), reach, true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined,
        other => other.handle !== playerCollider.handle && !dynamicHandles.has(other.handle));
      return hit?.timeOfImpact;
    },
    /** The first furniture, wall or floor along a ray and the way its face looks, ignoring loose props and the resident. */
    solidHit(origin: THREE.Vector3, direction: THREE.Vector3, reach: number): { distance: number; normal: THREE.Vector3 } | undefined {
      if (disposed || !finite(origin) || !finite(direction) || !(reach > 0)) return;
      const hit = world.castRayAndGetNormal(new RAPIER.Ray(origin, direction), reach, true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined,
        other => other.handle !== playerCollider.handle && !dynamicHandles.has(other.handle));
      return hit ? { distance: hit.timeOfImpact, normal: new THREE.Vector3().copy(hit.normal) } : undefined;
    },
    onSettled(listener: (id: string) => void): () => void {
      settledListeners.add(listener);
      return () => { settledListeners.delete(listener); };
    },
    /** Impacts since the last call; the caller owns the returned array. */
    drainImpacts(): PropImpact[] { return impacts.splice(0, impacts.length); },
    dynamicIds: () => [...dynamics.keys()],
  };
  return system;
}

export type HomePropPhysics = ReturnType<typeof createHomePropPhysics>;
