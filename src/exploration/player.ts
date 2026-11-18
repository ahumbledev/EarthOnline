import { createCollisionBaker, type CollisionData } from './collision-bake.ts';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { initializePhysics } from './rapier.ts';
export { initializePhysics } from './rapier.ts';
import { createVehiclePhysicsSystem } from './vehicle-physics.ts';
import type { VehicleActionResult, VehicleInput, VehicleOptions, VehiclePhysics } from './vehicle-physics.ts';
import { createResourcePhysicsSystem } from './resource-physics.ts';
import type { ResourceActionResult, ResourcePhysics, ResourcePhysicsOptions } from './resource-physics.ts';

/** World units are metres; position and the avatar's origin are at its feet. */
export const CHARACTER_HEIGHT = 1.75;
export const CHARACTER_RADIUS = 0.24;
const CHARACTER_HALF_HEIGHT = CHARACTER_HEIGHT / 2;
const CAPSULE_HALF_SEGMENT = CHARACTER_HALF_HEIGHT - CHARACTER_RADIUS;
const CONTACT_OFFSET = 0.015;
/** Tallest riser, kerb or threshold climbed without a jump. */
const STEP_HEIGHT = 0.26;
/** Ground followed downward in one tick: slopes, kerbs and stair treads. */
const SNAP_DISTANCE = 0.26;
const FIXED_STEP = 1 / 120;
const SPRINT_EVIDENCE_SECONDS = .05;
const WALK_SPEED = 1.3;
const RUN_SPEED = 5.2;
const GRAVITY = 18;
/** Falling is a little heavier than rising: the same apex with a firmer landing. */
const FALL_GRAVITY = 23;
const JUMP_SPEED = 5.5;
const MAX_FALL_SPEED = 35;
/** A press just before landing, or just after walking off an edge, still jumps. */
const JUMP_BUFFER_SECONDS = .12;
const COYOTE_SECONDS = .1;
/** A capsule that has just climbed a riser may hover until it is over the tread. */
const STEP_SUPPORT_SECONDS = .4;
/** Metres/s². Ground turns steer momentum; air input can only bend it gently. */
const WALK_ACCELERATION = 8, RUN_ACCELERATION = 16, WALK_BRAKING = 10, RUN_BRAKING = 24;
const AIR_ACCELERATION = 6;
/** Exponential released-input air drag, 1/s. */
const AIR_DRAG = 1.5;
/** Radians/s: turn faster at low speed, carve a wider turn while running. */
const WALK_TURN_RATE = 10, RUN_TURN_RATE = 8, PIVOT_TURN_RATE = 12;
const WALKABLE_NORMAL_Y = Math.cos(Math.PI / 4);
/** The support probe's radius inset and release height inside the capsule, m. */
const SUPPORT_INSET = .03;
/** Grounded slides rise this much, so the floor never reads as an obstacle; support settles it again. */
const GROUND_CLEARANCE = .001;
/** Contacts flatter than this face sideways: walls and kerb faces, never support. */
const WALL_NORMAL_Y = .2;
const LEVEL_TREAD_NORMAL_Y = Math.cos(THREE.MathUtils.degToRad(18));
/** Render-only easing of a stair or kerb height change, 1/s. */
const STEP_SMOOTHING = 28;
/** Camera arms keep this clearance, so the near plane never enters a wall. */
const CAMERA_PROBE_RADIUS = .2;
/** How far to either side of the arm a sight line must pass an obstacle for it to count as a post, and how far past its near face the lens resumes. */
const CAMERA_POST_CLEARANCE = .4, CAMERA_POST_DEPTH = .6;

export interface PlayerController {
  readonly object: THREE.Group;
  /** Live world-space feet position. Treat as read-only; use teleport to move it. */
  readonly position: THREE.Vector3;
  /** Feet blended between fixed physics steps. Drive cameras and visuals from it. */
  readonly renderPosition: THREE.Vector3;
  /** Downward speed of a landing during the latest update, m/s; 0 when none. */
  readonly landingSpeed: number;
  readonly grounded: boolean;
  readonly collisionTimings: { builds: number; totalMs: number; maxMs: number };
  readonly sprinting: boolean;
  /** Horizontal momentum in metres/s. Read-only; never mutate this reference. */
  readonly horizontalVelocity: THREE.Vector3;
  /** A navigation/actor boundary blocks coasting as well as new input. */
  stopHorizontalMotion(): void;
  readonly drivingVehicle: VehiclePhysics | undefined;
  /** An independently owned ride that shares this controller's fixed-step world. */
  readonly ridingActor: RidingActor | undefined;
  beginRide(actor: RidingActor): VehicleActionResult;
  endRide(): VehicleActionResult;
  /** Replace one independently owned static mesh; invalid/occupied replacements keep the old collider. */
  setStaticCollision(id: string, environment: THREE.Object3D, options?: StaticCollisionOptions): void;
  setStaticCollisionAsync(id: string, environment: THREE.Object3D, options?: StaticCollisionOptions): Promise<void>;
  removeStaticCollision(id: string): boolean;
  setKinematicCollision(id: string, environment: THREE.Object3D, position: THREE.Vector3, rotation: THREE.Quaternion): void;
  moveKinematicCollision(id: string, position: THREE.Vector3, rotation: THREE.Quaternion): void;
  floorHeight?(x: number, z: number, top: number, distance: number): number | undefined;
  /** True when fixed collision (a wall, a railing, street furniture) reaches into an upright box centred here. */
  fixedCollisionInBox?(x: number, y: number, z: number, halfWidth: number, halfHeight: number): boolean;
  addVehicle(options: VehicleOptions): VehiclePhysics;
  getVehicle(id: string): VehiclePhysics | undefined;
  getVehicleState(id: string): VehiclePhysics | undefined;
  setVehicleInput(id: string, input: Partial<VehicleInput>): boolean;
  resetVehicle(id: string, position?: THREE.Vector3, quaternion?: THREE.Quaternion): boolean;
  removeVehicle(id: string): boolean;
  enterVehicle(id: string): VehicleActionResult;
  exitVehicle(): VehicleActionResult;
  addResource(options: ResourcePhysicsOptions): ResourcePhysics;
  getResource(id: string): ResourcePhysics | undefined;
  fellResource(id: string, direction: THREE.Vector3): ResourceActionResult;
  /** Collect only a physically settled log; its fixed stump remains solid. */
  collectResource(id: string): boolean;
  /** Regrow only when the standing trunk is clear of the player and vehicles. */
  restoreResource(id: string): boolean;
  /** Query the resource's complete original solid volume without stepping or moving any body. */
  canRestoreResource(id: string): boolean;
  removeResource(id: string): boolean;
  update(dt: number, direction: THREE.Vector3, running: boolean, jump: boolean): void;
  teleport(feet: THREE.Vector3): void;
  /** Shorten a camera arm so a small sphere around the lens stays clear of solids. */
  constrainCamera(target: THREE.Vector3, desired: THREE.Vector3): THREE.Vector3;
  /** Add scene-owned bodies to this controller's world and fixed-step lifecycle. */
  attachPhysics<T extends PhysicsAttachment>(create: (world: RAPIER.World, playerCollider: RAPIER.Collider) => T): T;
  dispose(): void;
}

/**
 * How a static collider takes part in queries beyond stopping the player and vehicles. Street furniture
 * (posts, bins, railings) is solid but is no floor for the host's ground probes, and a thin post between
 * the player and the camera does not pull the camera in.
 */
export interface StaticCollisionOptions {
  /** false: floorHeight() looks through it. Default true. */
  floorProbe?: boolean;
  /** false: constrainCamera() looks through it. Default true. */
  camera?: boolean;
}

/** Hooks run around each fixed step. Attachments must not step or free the world. */
export interface PhysicsAttachment {
  beforeStep?(dt: number): void;
  afterStep?(dt: number): void;
  /** Blend display poses by the fraction of a fixed step not yet simulated. */
  interpolate?(alpha: number): void;
  /** Loose props may be pushed through instead of blocking or supporting walking. */
  passable?(collider: RAPIER.Collider): boolean;
  dispose?(): void;
}

/** The render origin remains at ground level; the avatar owns its seated pose. */
export interface RidingActor {
  readonly body: RAPIER.RigidBody;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly render: { position: THREE.Vector3; quaternion: THREE.Quaternion };
  readonly speedMps: number;
  readonly disposed: boolean;
  park(): void;
  /** Optional compact body envelope for a visible rider while mounted. */
  setRiderEnabled?(enabled: boolean): void;
}

/** A visual avatar can change appearance without replacing the physics root. */
export interface PlayerAvatar {
  readonly object: THREE.Group;
  updateMotion(dt: number, motion: {
    speed: number; distance?: number; grounded: boolean; sprinting: boolean; turnRate?: number;
    /** Smoothed change of displayed horizontal speed, m/s²; negative when braking. */
    acceleration?: number;
    /** Physical rise/fall speed, m/s; zero on supported ground. */
    verticalSpeed?: number;
    /** Largest downward landing speed this update, m/s; zero without an impact. */
    landingSpeed?: number;
  }): void;
  dispose(): void;
}

interface CollisionMesh {
  geometry: THREE.BufferGeometry;
  transform: THREE.Matrix4;
}

/** Bake rendered environment transforms into one immutable collision mesh. */
function environmentCollision(environment: THREE.Object3D) {
  environment.updateWorldMatrix(true, true);
  const parts: CollisionMesh[] = [];
  let vertexCount = 0;
  let indexCount = 0;

  environment.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    // Explicit authoring metadata can mark decoration as non-solid. Do not
    // approximate whole buildings with boxes: that would seal their doorways.
    let ancestor: THREE.Object3D | null = object;
    while (ancestor) {
      if (!ancestor.visible || ancestor.userData.collision === false) return;
      if (ancestor === environment) break;
      ancestor = ancestor.parent;
    }
    const geometry: THREE.BufferGeometry = object.geometry;
    const positions = geometry.getAttribute('position');
    if (!positions || positions.count < 3) return;
    const count = geometry.index?.count ?? positions.count;
    if (count < 3) return;

    const addPart = (transform: THREE.Matrix4) => {
      parts.push({ geometry, transform });
      vertexCount += positions.count;
      indexCount += Math.floor(count / 3) * 3;
    };
    if (object instanceof THREE.InstancedMesh) {
      const instance = new THREE.Matrix4();
      for (let index = 0; index < object.count; index++) {
        object.getMatrixAt(index, instance);
        addPart(new THREE.Matrix4().multiplyMatrices(object.matrixWorld, instance));
      }
    } else {
      addPart(object.matrixWorld.clone());
    }
  });

  if (indexCount === 0) throw new Error('The exploration environment has no collision geometry.');
  const vertices = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  const point = new THREE.Vector3();
  let vertexOffset = 0;
  let indexOffset = 0;

  for (const { geometry, transform } of parts) {
    const positions = geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index++) {
      point.fromBufferAttribute(positions, index).applyMatrix4(transform);
      const offset = (vertexOffset + index) * 3;
      vertices[offset] = point.x;
      vertices[offset + 1] = point.y;
      vertices[offset + 2] = point.z;
    }
    const geometryIndex = geometry.index;
    const count = Math.floor((geometryIndex?.count ?? positions.count) / 3) * 3;
    const mirrored = transform.determinant() < 0;
    for (let index = 0; index < count; index += 3) {
      const a = geometryIndex ? geometryIndex.getX(index) : index;
      const b = geometryIndex ? geometryIndex.getX(index + 1) : index + 1;
      const c = geometryIndex ? geometryIndex.getX(index + 2) : index + 2;
      indices[indexOffset++] = vertexOffset + a;
      indices[indexOffset++] = vertexOffset + (mirrored ? c : b);
      indices[indexOffset++] = vertexOffset + (mirrored ? b : c);
    }
    vertexOffset += positions.count;
  }
  return { vertices, indices };
}

function createAvatar() {
  const object = new THREE.Group();
  object.name = 'Exploration player';
  const body = new THREE.Group();
  object.add(body);
  const shirt = new THREE.MeshStandardMaterial({ color: '#df713d', roughness: 0.85 });
  const trousers = new THREE.MeshStandardMaterial({ color: '#263947', roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: '#d5a07b', roughness: 0.9 });
  const hair = new THREE.MeshStandardMaterial({ color: '#302b29', roughness: 1 });
  const shoes = new THREE.MeshStandardMaterial({ color: '#20262b', roughness: 1 });

  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x: number, y: number, z = 0) => {
    const part = new THREE.Mesh(geometry, material);
    part.position.set(x, y, z);
    part.castShadow = true;
    part.receiveShadow = true;
    parent.add(part);
    return part;
  };
  mesh(new THREE.BoxGeometry(0.38, 0.56, 0.23), shirt, body, 0, 1.09);
  mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.12, 8), skin, body, 0, 1.42);
  mesh(new THREE.SphereGeometry(0.155, 12, 10), skin, body, 0, 1.585);
  const cap = mesh(new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair, body, 0, 1.585);
  cap.scale.y = 1.02;
  // A small nose also makes the avatar's forward (+Z) direction visible.
  mesh(new THREE.BoxGeometry(0.055, 0.065, 0.06), skin, body, 0, 1.57, 0.15);

  const limbs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.105, 0.83, 0);
    body.add(leg);
    mesh(new THREE.BoxGeometry(0.15, 0.65, 0.17), trousers, leg, 0, -0.325);
    mesh(new THREE.BoxGeometry(0.17, 0.13, 0.28), shoes, leg, 0, -0.755, 0.035);
    limbs.push(leg);
    const arm = new THREE.Group();
    arm.position.set(side * 0.245, 1.32, 0);
    body.add(arm);
    mesh(new THREE.BoxGeometry(0.12, 0.30, 0.14), shirt, arm, 0, -0.15);
    mesh(new THREE.BoxGeometry(0.105, 0.25, 0.12), skin, arm, 0, -0.40);
    limbs.push(arm);
  }
  return { object, body, limbs };
}



const UP = { x: 0, y: 1, z: 0 };
const DOWN = { x: 0, y: -1, z: 0 };
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

export async function createPlayerController(
  environment: THREE.Object3D,
  spawn: THREE.Vector3,
  avatarModel?: PlayerAvatar,
): Promise<PlayerController> {
  await initializePhysics();
  const collisionBaker=createCollisionBaker();
  let initial: CollisionData;
  try { initial=await collisionBaker.bake(environment); } catch(error) { collisionBaker.dispose();throw error; }
  const {vertices,indices}=initial;

  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  const staticColliders = new Map<string, RAPIER.Collider>();
  /** Static colliders (by handle) that floor probes and the camera arm look through (StaticCollisionOptions). */
  const probeThrough = new Set<number>(), cameraThrough = new Set<number>();
  const floorFilter = (other: RAPIER.Collider) => !probeThrough.has(other.handle);
  const forgetStatic = (previous: RAPIER.Collider) => { probeThrough.delete(previous.handle); cameraThrough.delete(previous.handle); };
  const kinematicColliders = new Map<string, { body: RAPIER.RigidBody; collider: RAPIER.Collider }>();
  const floorRay = new RAPIER.Ray({x:0,y:0,z:0},DOWN);
  world.timestep = FIXED_STEP;
  const collisionTimings={builds:1,totalMs:0,maxMs:0};
  const initialColliderStart=performance.now();
  world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices));
  collisionTimings.totalMs=collisionTimings.maxMs=performance.now()-initialColliderStart;
  const rigidBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + CHARACTER_HALF_HEIGHT, spawn.z),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(CAPSULE_HALF_SEGMENT, CHARACTER_RADIUS).setFriction(0),
    rigidBody,
  );
  const controller = world.createCharacterController(CONTACT_OFFSET);
  const vehicles = createVehiclePhysicsSystem(world, collider);
  const resources = createResourcePhysicsSystem(world, collider);
  world.maxCcdSubsteps = 4;
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.setSlideEnabled(true);
  controller.setMaxSlopeClimbAngle(Math.PI / 4);
  controller.setMinSlopeSlideAngle(Math.PI / 4);
  // Grounded ticks ask Rapier only for the horizontal slide. Its autostep and
  // ground snap work inside the contact skin: on real triangle meshes they
  // stalled at seams, never climbed a riser and could skip a floor entirely.
  // Steps and ground following are resolved below with explicit shape casts.
  // A first step populates Rapier's spatial queries before any character move.
  world.step();

  // The browser supplies a loaded model; physics tests keep an offline fallback.
  const fallbackAvatar = avatarModel ? undefined : createAvatar();
  const avatar = { object: avatarModel?.object ?? fallbackAvatar!.object };
  const position = spawn.clone();
  // Fixed 120 Hz steps are blended for display, so motion is even at 60, 90,
  // 144 or 165 Hz instead of advancing zero, one or two ticks per frame.
  const previousFeet = spawn.clone(), currentFeet = spawn.clone();
  const renderPosition = spawn.clone(), renderedFeet = spawn.clone();
  avatar.object.position.copy(position);
  const movement = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const targetVelocity = new THREE.Vector3();
  const displacement = new THREE.Vector3();
  const shownVelocity = new THREE.Vector3();
  const blockedWallNormal = new THREE.Vector3();
  let hasBlockedWall = false;
  let travelHeading = avatar.object.rotation.y, lastShownHeading = travelHeading;
  let lastMotionSpeed = 0, motionAcceleration = 0;
  const cameraDirection = new THREE.Vector3();
  const constrainedCamera = new THREE.Vector3();
  const cameraSide = new THREE.Vector3(), cameraStart = new THREE.Vector3();
  const step = { x: 0, y: 0, z: 0 };
  const groundNormal = new THREE.Vector3(0, 1, 0);
  let accumulator = 0;
  let verticalSpeed = 0;
  let grounded = false;
  let coyoteRemaining = 0;
  let stepSupportRemaining = 0;
  let stepSupportFeet = 0;
  let stepOffset = 0;
  let landingSpeed = 0;
  let jumpWasPressed = false;
  let jumpBuffer = 0;
  let animationPhase = 0;
  let animationWeight = 0;
  let sprinting = false;
  let sprintEvidenceRemaining = 0;
  let disposed = false;
  let driving: VehiclePhysics | undefined;
  let riding: RidingActor | undefined;
  const beforeRidingPosition = spawn.clone();
  let savedAvatarVisible = true;
  const beforeDrivingPosition = spawn.clone();
  const seat = new THREE.Vector3();
  const capsuleShape = new RAPIER.Capsule(CAPSULE_HALF_SEGMENT, CHARACTER_RADIUS);
  const cameraProbe = new RAPIER.Ball(CAMERA_PROBE_RADIUS);
  const cameraLane = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  const SOLID = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
  const STATIC_SOLID = SOLID | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC;
  // A falling log must not yank the camera arm in; cars and the city still do.
  const cameraObstacle = (other: RAPIER.Collider) => {
    if (cameraThrough.has(other.handle)) return false;
    const parent = other.parent();
    return !parent || !parent.isDynamic() || vehicles.owns(parent);
  };

  const attachments = new Set<PhysicsAttachment>();
  const walkable = (other: RAPIER.Collider) => {
    for (const attachment of attachments) if (attachment.passable?.(other)) return false;
    return true;
  };
  // Preserve the native no-predicate query path in scenes without loose props.
  let attachmentFilter: typeof walkable | undefined;

  // Stopping at an initial skin contact is right for a ground probe, but a
  // headroom cast must ignore the floor it is moving away from.
  const castCapsule = (from: RAPIER.Vector, direction: RAPIER.Vector, distance: number, filter = SOLID, stopAtSkin = true) =>
    world.castShape(from, IDENTITY, direction, capsuleShape, CONTACT_OFFSET, distance, stopAtSkin, filter, undefined, collider, undefined, attachmentFilter);
  // Support is probed with a ball 3 cm narrower than the capsule, released from
  // inside its lower hemisphere and resolved to the same lowest point. A wall's
  // contact skin beside the capsule is then never mistaken for ground, the rest
  // height is exact even when a slide ended inside the floor's skin, and slopes
  // up to the climb limit stay within the capsule's own skin.
  const supportProbe = new RAPIER.Ball(CHARACTER_RADIUS - SUPPORT_INSET);
  const castSupport = (x: number, y: number, z: number, maxDrop: number) => {
    const from = { x, y: y - CHARACTER_HALF_HEIGHT + CHARACTER_RADIUS, z };
    let hit = world.castShape(from, IDENTITY, DOWN, supportProbe, CONTACT_OFFSET, maxDrop + SUPPORT_INSET, true, SOLID, undefined, collider, undefined, attachmentFilter);
    // A capsule pressed into the side of a kerb or wall starts the probe inside
    // that face. Look past it for the floor; vertical faces never hold anyone up.
    if (hit && Math.abs(hit.normal2.y) < WALL_NORMAL_Y && hit.time_of_impact < 1e-4) {
      hit = world.castShape(from, IDENTITY, DOWN, supportProbe, CONTACT_OFFSET, maxDrop + SUPPORT_INSET, false, SOLID, undefined, collider, undefined, attachmentFilter);
    }
    return hit && { drop: hit.time_of_impact - SUPPORT_INSET, normalY: -hit.normal2.y, normal: hit.normal2 };
  };
  const castDown = (x: number, y: number, z: number, length: number, filter = SOLID) =>
    world.castRayAndGetNormal(new RAPIER.Ray({ x, y, z }, DOWN), length, true, filter, undefined, collider, undefined, attachmentFilter);

  /**
   * Drop that rests the moved capsule on support, or undefined when nothing
   * holds it up. Steep contacts only support a capsule rolling over the edge of
   * a stair or kerb, or one finishing a climb onto a tread it has not reached.
   * A rail or root too thin for the probe still counts when the controller
   * itself reports standing on it, so the capsule never hangs there airborne.
   */
  let walkableSupport = false;
  const findSupport = (x: number, y: number, z: number, maxDrop: number, restingOnContact: boolean) => {
    walkableSupport = false;
    const hit = castSupport(x, y, z, maxDrop);
    // normal2 is the probe's own outward normal; the support faces against it.
    if (hit && hit.normalY >= WALKABLE_NORMAL_Y
      && (stepSupportRemaining <= 0 || y - CHARACTER_HALF_HEIGHT - hit.drop > stepSupportFeet - .003)) {
      walkableSupport = true;
      groundNormal.set(-hit.normal.x, -hit.normal.y, -hit.normal.z);
      return hit.drop;
    }
    if (stepSupportRemaining > 0) return 0;
    // Rolling over a stair or kerb edge still needs a walkable floor below.
    // The narrow probe can miss that floor while the capsule touches a riser.
    if ((hit && hit.normalY > WALL_NORMAL_Y) || restingOnContact) {
      const floor = castDown(x, y - CHARACTER_HALF_HEIGHT + .05, z, maxDrop + .1);
      if (floor && floor.normal.y >= WALKABLE_NORMAL_Y) return Math.max(0, hit?.drop ?? 0);
    }
    if (restingOnContact) {
      // Rapier also reports grounded on steep faces. Only a walkable contact
      // may substitute for the narrower probe; otherwise gravity must resume.
      for (let index = 0; index < controller.numComputedCollisions(); index++) {
        const normal = controller.computedCollision(index)?.normal1;
        if (normal && normal.y >= WALKABLE_NORMAL_Y) return 0;
      }
    }
    return undefined;
  };

  /** A riser-like face that stopped the latest slide, with its world-space contact. */
  const riserCollision = () => {
    for (let index = 0; index < controller.numComputedCollisions(); index++) {
      const collision = controller.computedCollision(index);
      const normal = collision?.normal1;
      if (normal && normal.y < WALKABLE_NORMAL_Y && normal.y > -.2) return collision;
    }
    return undefined;
  };
  /** Lift onto a level tread when a low riser blocks most of a grounded move. */
  const climbStep = (start: RAPIER.Vector, dx: number, dz: number, progress: number) => {
    const wanted = Math.hypot(dx, dz);
    if (wanted < 1e-5 || progress > wanted * .75) return undefined;
    const riser = riserCollision();
    if (!riser) return undefined;
    const ux = dx / wanted, uz = dz / wanted, feet = start.y - CHARACTER_HALF_HEIGHT;
    const reach = CHARACTER_RADIUS + CONTACT_OFFSET + Math.max(wanted, .05), top = STEP_HEIGHT + .05;
    let tread = castDown(start.x + ux * reach, feet + top, start.z + uz * reach, top, STATIC_SOLID);
    // A thin threshold may end before the usual look-ahead ray. Probe just
    // inside the actual contact as well, so narrow thresholds are not skipped.
    for (const inset of [.003, .0003]) {
      if (tread && tread.normal.y >= LEVEL_TREAD_NORMAL_Y && top - tread.timeOfImpact + CONTACT_OFFSET >= .02) break;
      tread = castDown(riser.witness1.x + ux * inset, feet + top, riser.witness1.z + uz * inset, top, STATIC_SOLID);
    }
    // Stair treads and kerb tops are level; ramps are followed by the slide itself.
    if (!tread || tread.normal.y < LEVEL_TREAD_NORMAL_Y) return undefined;
    const rise = top - tread.timeOfImpact + CONTACT_OFFSET;
    if (rise < .02 || rise > STEP_HEIGHT + CONTACT_OFFSET || castCapsule(start, UP, rise, SOLID, false)) return undefined;
    const ahead = castCapsule({ x: start.x, y: start.y + rise, z: start.z }, { x: ux, y: 0, z: uz }, wanted);
    const advance = ahead ? ahead.time_of_impact : wanted;
    if (advance < progress + wanted * .25) return undefined;
    stepSupportRemaining = STEP_SUPPORT_SECONDS; stepSupportFeet = feet + rise;
    step.x = ux * advance; step.y = rise; step.z = uz * advance;
    return step;
  };

  const clearWalkingMotion = () => {
    verticalSpeed = 0; velocity.set(0, 0, 0);
    hasBlockedWall = false;
    lastMotionSpeed = 0; motionAcceleration = 0; travelHeading = avatar.object.rotation.y;
    grounded = false; sprinting = false; sprintEvidenceRemaining = 0;
    accumulator = 0; jumpBuffer = 0; jumpWasPressed = false;
    coyoteRemaining = 0; stepSupportRemaining = 0; groundNormal.set(0, 1, 0);
  };
  const placeFeet = (feet: THREE.Vector3) => {
    const translation = { x: feet.x, y: feet.y + CHARACTER_HALF_HEIGHT, z: feet.z };
    rigidBody.setTranslation(translation, true);
    rigidBody.setNextKinematicTranslation(translation);
    world.propagateModifiedBodyPositionsToColliders();
    currentFeet.copy(feet); previousFeet.copy(feet); stepOffset = 0;
  };
  const cancelDriving = (feet: THREE.Vector3) => {
    if (driving) { driving.park(); driving = undefined; avatar.object.visible = savedAvatarVisible; }
    collider.setEnabled(true); clearWalkingMotion(); placeFeet(feet);
  };
  const cancelRide = (feet: THREE.Vector3) => {
    riding?.park(); riding?.setRiderEnabled?.(false); riding = undefined;
    collider.setEnabled(true); clearWalkingMotion(); placeFeet(feet);
    // The bike view may have added banking to the visible root.
    const heading = new THREE.Vector3(0, 0, 1).applyQuaternion(avatar.object.quaternion);
    avatar.object.rotation.set(0, Math.atan2(heading.x, heading.z), 0);
  };
  const pathClear = (fromFeet: THREE.Vector3, toFeet: THREE.Vector3, excluded: RAPIER.RigidBody | undefined) => {
    const from = fromFeet.clone().add(new THREE.Vector3(0, CHARACTER_HALF_HEIGHT, 0));
    const delta = toFeet.clone().sub(fromFeet);
    if (world.castShape(from, IDENTITY, delta, capsuleShape, .005, 1, true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, collider, excluded)) return false;
    // Newly spawned/reset dynamic bodies may not yet have had a broadphase
    // tick. Query their actual collider shapes too, without advancing the world.
    let clear = true;
    world.forEachCollider(other => {
      const parent = other.parent();
      if (!clear || !other.isEnabled() || other.isSensor() || !parent?.isDynamic() || parent.handle === excluded?.handle) return;
      if (other.castShape({ x: 0, y: 0, z: 0 }, capsuleShape, from, IDENTITY, delta, .005, 1, true)) clear = false;
    });
    return clear;
  };
  const rideStepPathClear = (fromFeet: THREE.Vector3, toFeet: THREE.Vector3, excluded: RAPIER.RigidBody) => {
    if (pathClear(fromFeet, toFeet, excluded)) return true;
    // Mounting from a pavement follows a step-over path, not a descending
    // diagonal through the kerb. Sweep the entire standing capsule upward,
    // across and down, so this allowance never bypasses a wall or low roof.
    if (Math.abs(fromFeet.y - toFeet.y) > STEP_HEIGHT + .04) return false;
    const top = Math.max(fromFeet.y, toFeet.y) + .035;
    const raisedFrom = fromFeet.clone().setY(top), raisedTo = toFeet.clone().setY(top);
    return pathClear(fromFeet, raisedFrom, excluded)
      && pathClear(raisedFrom, raisedTo, excluded)
      && pathClear(raisedTo, toFeet, excluded);
  };
  const vehicleMoving = (vehicle: VehiclePhysics, limit: number) => {
    const body = vehicles.bodyFor(vehicle.id)!;
    const linear = body.linvel(), angular = body.angvel();
    return Math.hypot(linear.x, linear.y, linear.z) > limit || Math.hypot(angular.x, angular.y, angular.z) > 1;
  };

  /** Copy the physics feet; a snap also drops the display blend, e.g. after a teleport. */
  const syncPosition = (snap = false) => {
    const center = rigidBody.translation();
    position.set(center.x, center.y - CHARACTER_HALF_HEIGHT, center.z);
    if (!snap) return;
    currentFeet.copy(position); previousFeet.copy(position); stepOffset = 0;
    renderPosition.copy(position); renderedFeet.copy(position);
    avatar.object.position.copy(position);
    vehicles.interpolate(1); resources.interpolate(1);
    for (const attachment of attachments) attachment.interpolate?.(1);
  };
  /** Display state for the fraction of a fixed step not yet simulated. */
  const present = (elapsed: number) => {
    const alpha = THREE.MathUtils.clamp(accumulator / FIXED_STEP, 0, 1);
    vehicles.interpolate(alpha); resources.interpolate(alpha);
    for (const attachment of attachments) attachment.interpolate?.(alpha);
    if (riding && !riding.disposed) {
      renderPosition.copy(riding.render.position);
      avatar.object.quaternion.copy(riding.render.quaternion);
    } else if (driving && !driving.disposed) {
      const pose = driving.render;
      renderPosition.copy(driving.config.seatPosition).applyQuaternion(pose.quaternion).add(pose.position);
    } else renderPosition.lerpVectors(previousFeet, currentFeet, alpha);
    stepOffset *= Math.exp(-STEP_SMOOTHING * elapsed);
    if (Math.abs(stepOffset) < 1e-4) stepOffset = 0;
    avatar.object.position.copy(renderPosition);
    avatar.object.position.y += stepOffset;
    const travelled = Math.hypot(renderPosition.x - renderedFeet.x, renderPosition.z - renderedFeet.z);
    renderedFeet.copy(renderPosition);
    return travelled;
  };

  const stepWorld = () => {
    vehicles.beforeStep(FIXED_STEP); resources.beforeStep(FIXED_STEP);
    for (const attachment of attachments) attachment.beforeStep?.(FIXED_STEP);
    world.step(); vehicles.afterStep(); resources.afterStep(FIXED_STEP);
    for (const attachment of attachments) attachment.afterStep?.(FIXED_STEP);
    if (riding) return true;
    const safeFeet = resources.safePlayerFeet(CHARACTER_HEIGHT, CHARACTER_RADIUS);
    if (safeFeet) {
      placeFeet(safeFeet); velocity.set(0, 0, 0); verticalSpeed = 0;
      hasBlockedWall = false;
      lastMotionSpeed = 0; motionAcceleration = 0;
      grounded = false; sprintEvidenceRemaining = 0; stepSupportRemaining = 0;
      return false;
    }
    return true;
  };

  /** One fixed step of walking physics. Returns the horizontal distance moved. */
  const walkStep = (canRun: boolean) => {
    const moving = movement.lengthSq() > .001;
    const speed = velocity.length();
    if (grounded) {
      targetVelocity.copy(movement);
      if (hasBlockedWall) {
        // Steer along the last tick's real wall instead of repeatedly turning
        // into it and losing that turn when collision projects the velocity.
        const intoWall = targetVelocity.dot(blockedWallNormal);
        if (intoWall < 0) targetVelocity.addScaledVector(blockedWallNormal, -intoWall);
      }
      const heading = speed > .01 ? Math.atan2(velocity.x, velocity.z) : travelHeading;
      let turn = 0, targetSpeed = 0;
      if (targetVelocity.lengthSq() > .001) {
        const wanted = Math.atan2(targetVelocity.x, targetVelocity.z);
        const delta = THREE.MathUtils.euclideanModulo(wanted - heading + Math.PI, Math.PI * 2) - Math.PI;
        const turnRate = THREE.MathUtils.lerp(PIVOT_TURN_RATE, canRun ? RUN_TURN_RATE : WALK_TURN_RATE,
          Math.min(1, speed / (canRun ? RUN_SPEED : WALK_SPEED)));
        turn = THREE.MathUtils.clamp(delta, -turnRate * FIXED_STEP, turnRate * FIXED_STEP);
        // Ordinary arcs keep their pace. Near-reversals first shed speed so a
        // planted turn replaces sideways skating at the old running speed.
        const alignment = Math.cos(delta - turn);
        const turnSpeed = THREE.MathUtils.smoothstep(alignment, -.2, .8);
        targetSpeed = targetVelocity.length() * (canRun ? RUN_SPEED : WALK_SPEED) * turnSpeed;
      }
      const rate = targetSpeed > speed ? (canRun ? RUN_ACCELERATION : WALK_ACCELERATION)
        : speed > WALK_SPEED + 1e-6 ? RUN_BRAKING : WALK_BRAKING;
      const change = THREE.MathUtils.clamp(targetSpeed - speed, -rate * FIXED_STEP, rate * FIXED_STEP);
      const nextSpeed = speed + change;
      const changingFor = Math.abs(change) / rate;
      const distance = (speed + nextSpeed) * .5 * changingFor + nextSpeed * (FIXED_STEP - changingFor);
      travelHeading = heading + turn;
      displacement.set(Math.sin(heading + turn * .5) * distance, 0, Math.cos(heading + turn * .5) * distance);
      velocity.set(Math.sin(travelHeading) * nextSpeed, 0, Math.cos(travelHeading) * nextSpeed);
    } else if (moving) {
      targetVelocity.copy(movement).multiplyScalar(canRun ? RUN_SPEED : WALK_SPEED).sub(velocity);
      const change = targetVelocity.length();
      if (change > AIR_ACCELERATION * FIXED_STEP) targetVelocity.multiplyScalar(AIR_ACCELERATION * FIXED_STEP / change);
      displacement.copy(velocity).addScaledVector(targetVelocity, .5).multiplyScalar(FIXED_STEP);
      velocity.add(targetVelocity);
    } else {
      const decay = Math.exp(-AIR_DRAG * FIXED_STEP);
      displacement.copy(velocity).multiplyScalar((1 - decay) / AIR_DRAG);
      velocity.multiplyScalar(decay);
    }

    if (jumpBuffer > 0 && (grounded || coyoteRemaining > 0)) {
      verticalSpeed = JUMP_SPEED;
      grounded = false; coyoteRemaining = 0; jumpBuffer = 0; stepSupportRemaining = 0;
    }
    jumpBuffer = Math.max(0, jumpBuffer - FIXED_STEP);
    coyoteRemaining = Math.max(0, coyoteRemaining - FIXED_STEP);
    stepSupportRemaining = Math.max(0, stepSupportRemaining - FIXED_STEP);

    const wasGrounded = grounded;
    const start = rigidBody.translation();
    let moveX: number, moveY: number, moveZ: number, steppedUp = false;
    if (grounded) {
      // Slide along the supporting plane only. Pushing gravity into the floor
      // stalls the controller wherever two floor triangles meet, and a level
      // move up or down a ramp would lose speed or skip down it in hops.
      const along = groundNormal.y < .9994 ? -(groundNormal.x * displacement.x + groundNormal.z * displacement.z) / groundNormal.y : 0;
      controller.computeColliderMovement(collider, { x: displacement.x, y: along + GROUND_CLEARANCE, z: displacement.z }, SOLID, undefined, attachmentFilter);
      const slide = controller.computedMovement();
      moveX = slide.x; moveY = slide.y; moveZ = slide.z;
      const climbed = climbStep(start, displacement.x, displacement.z, Math.hypot(moveX, moveZ));
      if (climbed) { moveX = climbed.x; moveY = climbed.y; moveZ = climbed.z; steppedUp = true; }
      const drop = findSupport(start.x + moveX, start.y + moveY, start.z + moveZ, SNAP_DISTANCE, controller.computedGrounded());
      if (drop === undefined) { grounded = false; coyoteRemaining = COYOTE_SECONDS; stepSupportRemaining = 0; groundNormal.set(0, 1, 0); }
      else {
        moveY -= drop;
        // Standing on the tread itself ends the hover allowance.
        if (!climbed && walkableSupport && drop < .02) stepSupportRemaining = 0;
      }
      verticalSpeed = 0;
    } else {
      verticalSpeed = Math.max(-MAX_FALL_SPEED, verticalSpeed - (verticalSpeed > 0 ? GRAVITY : FALL_GRAVITY) * FIXED_STEP);
      const rise = verticalSpeed * FIXED_STEP;
      controller.computeColliderMovement(collider, { x: displacement.x, y: rise, z: displacement.z }, SOLID, undefined, attachmentFilter);
      const flight = controller.computedMovement();
      moveX = flight.x; moveY = flight.y; moveZ = flight.z;
      // Cancel upward velocity if a ceiling stops the capsule.
      if (verticalSpeed > 0 && moveY < rise * .5) verticalSpeed = 0;
      if (verticalSpeed <= 0) {
        const drop = findSupport(start.x + moveX, start.y + moveY, start.z + moveZ, .03, controller.computedGrounded());
        if (drop !== undefined) {
          moveY -= drop; landingSpeed = Math.max(landingSpeed, -verticalSpeed);
          grounded = true; verticalSpeed = 0; coyoteRemaining = 0;
        }
      }
    }
    hasBlockedWall = false;
    if (!steppedUp && Math.hypot(moveX, moveZ) < displacement.length() * .9) {
      // Walls remove only the blocked component of momentum. Keep the tangent
      // and successful step/ramp motion, without storing a full-speed launch
      // behind a stationary capsule.
      for (let index = 0; index < controller.numComputedCollisions(); index++) {
        const collision = controller.computedCollision(index), normal = collision?.normal1;
        if (!collision || !normal || Math.abs(normal.y) >= WALL_NORMAL_Y) continue;
        if (collision.witness1.y - (start.y - CHARACTER_HALF_HEIGHT) <= STEP_HEIGHT + .05) continue;
        const lengthSq = normal.x * normal.x + normal.z * normal.z;
        const intoWall = velocity.x * normal.x + velocity.z * normal.z;
        if (intoWall < 0 && lengthSq > .5) {
          if (grounded && !hasBlockedWall) {
            blockedWallNormal.set(normal.x, 0, normal.z).normalize(); hasBlockedWall = true;
          }
          velocity.x -= normal.x * intoWall / lengthSq;
          velocity.z -= normal.z * intoWall / lengthSq;
        }
      }
    }
    rigidBody.setNextKinematicTranslation({ x: start.x + moveX, y: start.y + moveY, z: start.z + moveZ });
    if (!stepWorld()) return 0;
    previousFeet.copy(currentFeet);
    const center = rigidBody.translation();
    currentFeet.set(center.x, center.y - CHARACTER_HALF_HEIGHT, center.z);
    const horizontal = Math.hypot(moveX, moveZ);
    // A riser or kerb changes height in one tick. Keep physics exact, but ease
    // the avatar through it instead of popping a whole step in one frame.
    if (wasGrounded && grounded && Math.abs(moveY) > .035 && Math.abs(moveY) > horizontal * 1.2) {
      stepOffset = THREE.MathUtils.clamp(stepOffset - moveY, -.3, .3);
      previousFeet.y += moveY;
    }
    return horizontal;
  };

  function installStaticCollision(id: string, data: CollisionData, options?: StaticCollisionOptions) {
      if (disposed) throw new Error('Player controller is disposed.');
      if (!id.trim()) throw new Error('Static collision identity is required.');
      const { vertices, indices } = data;
      for(let i=0;i<vertices.length;i++)if(!Number.isFinite(vertices[i]))throw new Error('Static collision contains invalid geometry.');
      for(let i=0;i<indices.length;i++)if(indices[i]>=vertices.length/3)throw new Error('Static collision contains invalid geometry.');
      const began=performance.now();
      const next = world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices));
      const duration=performance.now()-began;collisionTimings.builds++;collisionTimings.totalMs+=duration;collisionTimings.maxMs=Math.max(collisionTimings.maxMs,duration);
      try {
        let occupied = false;
        world.forEachCollider(other => {
          if (occupied || other.handle === next.handle || !other.isEnabled() || other.isSensor()) return;
          if (other.handle !== collider.handle && !other.parent()?.isDynamic()) return;
          // Query shapes directly: a new collider has not entered the broadphase yet.
          const contact = next.contactCollider(other, 0);
          if (contact && contact.distance < -.005) occupied = true;
        });
        if (occupied) throw new Error('Static collision is occupied by the player or a dynamic object. Move to a safe walkway first.');
      } catch (error) {
        world.removeCollider(next, true);
        throw error;
      }
      const previous = staticColliders.get(id);
      staticColliders.set(id, next);
      if (previous) { forgetStatic(previous); world.removeCollider(previous, true); }
      if (options?.floorProbe === false) probeThrough.add(next.handle);
      if (options?.camera === false) cameraThrough.add(next.handle);
      // Refresh spatial queries before a camera ray or the next character move.
      stepWorld(); syncPosition();
  }

  return {
    object: avatar.object,
    collisionTimings,
    position,
    renderPosition,
    get landingSpeed() { return landingSpeed; },
    get grounded() { return grounded; },
    get sprinting() { return sprinting; },
    get horizontalVelocity() { return velocity; },
    stopHorizontalMotion() { velocity.set(0, 0, 0); sprinting = false; sprintEvidenceRemaining = 0; },
    get drivingVehicle() { return driving?.disposed ? undefined : driving; },
    get ridingActor() { return riding?.disposed ? undefined : riding; },
    beginRide(actor) {
      if (disposed || actor.disposed) return { ok: false, reason: 'disposed' };
      if (driving || riding) return { ok: false, reason: 'already-driving' };
      if (position.distanceTo(actor.position) > 2.6) return { ok: false, reason: 'too-far' };
      const motion = actor.body.linvel();
      if (Math.hypot(motion.x, motion.y, motion.z) > .8) return { ok: false, reason: 'moving' };
      const mountFeet = actor.position.clone().add(new THREE.Vector3(0, .04, 0));
      if (!rideStepPathClear(position, mountFeet, actor.body)) return { ok: false, reason: 'blocked' };
      beforeRidingPosition.copy(position); riding = actor; actor.park();
      actor.setRiderEnabled?.(true);
      collider.setEnabled(false); clearWalkingMotion(); placeFeet(actor.position); syncPosition(true);
      avatar.object.quaternion.copy(actor.quaternion);
      return { ok: true };
    },
    endRide() {
      if (disposed) return { ok: false, reason: 'disposed' };
      if (!riding || riding.disposed) return { ok: false, reason: 'not-found' };
      const actor = riding, motion = actor.body.linvel();
      if (Math.hypot(motion.x, motion.y, motion.z) > .8) return { ok: false, reason: 'moving' };
      for (const [x, z] of [[.85, 0], [-.85, 0], [.85, -.5], [-.85, -.5], [0, -1.6]]) {
        const point = new THREE.Vector3(x, 0, z).applyQuaternion(actor.quaternion).add(actor.position);
        const hit = world.castRayAndGetNormal(new RAPIER.Ray({ x: point.x, y: point.y + 1, z: point.z }, DOWN), 1.7, true,
          STATIC_SOLID, undefined, collider, actor.body);
        if (!hit || hit.normal.y < WALKABLE_NORMAL_Y) continue;
        point.y += 1 - hit.timeOfImpact + CONTACT_OFFSET;
        if (Math.abs(point.y - actor.position.y) > .4) continue;
        const center = point.clone().add(new THREE.Vector3(0, CHARACTER_HALF_HEIGHT, 0));
        let blocked = false;
        world.forEachCollider(other => {
          if (blocked || !other.isEnabled() || other.isSensor() || other.handle === collider.handle) return;
          const contact = other.contactShape(capsuleShape, center, IDENTITY, .005);
          if (contact && contact.distance <= .005) blocked = true;
        });
        if (blocked || !rideStepPathClear(actor.position.clone().add(new THREE.Vector3(0, .04, 0)), point, actor.body)) continue;
        cancelRide(point); syncPosition(true); return { ok: true };
      }
      return { ok: false, reason: 'no-safe-exit' };
    },
    setStaticCollision(id, environment, options) { if(disposed)throw new Error('Player controller is disposed.'); installStaticCollision(id,environmentCollision(environment),options); },
    async setStaticCollisionAsync(id, environment, options) { installStaticCollision(id,await collisionBaker.bake(environment),options); },
    setKinematicCollision(id, environment, at, rotation) {
      if(disposed||!id.trim())throw new Error('Invalid kinematic collision owner');
      const {vertices,indices}=environmentCollision(environment);
      const inverse=new THREE.Matrix4().compose(at,rotation,new THREE.Vector3(1,1,1)).invert(),vertex=new THREE.Vector3();
      for(let i=0;i<vertices.length;i+=3){vertex.fromArray(vertices,i).applyMatrix4(inverse);vertex.toArray(vertices,i);}
      const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(at.x,at.y,at.z).setRotation(rotation));
      let next:RAPIER.Collider;
      try{
        next=world.createCollider(RAPIER.ColliderDesc.trimesh(vertices,indices),body);
        world.forEachCollider(other=>{
          if(other.handle===next.handle||!other.isEnabled()||other.isSensor()||other.handle!==collider.handle&&!other.parent()?.isDynamic())return;
          const contact=next.contactCollider(other,0);if(contact&&contact.distance<-.005)throw new Error('Kinematic collision is occupied');
        });
      }catch(error){world.removeRigidBody(body);throw error;}
      const previous=kinematicColliders.get(id);if(previous)world.removeRigidBody(previous.body);
      const previousStatic=staticColliders.get(id);if(previousStatic){forgetStatic(previousStatic);world.removeCollider(previousStatic,true);staticColliders.delete(id);}
      kinematicColliders.set(id,{body,collider:next});stepWorld();syncPosition();
    },
    moveKinematicCollision(id, at, rotation) {
      const entry=kinematicColliders.get(id);if(disposed||!entry)throw new Error('Kinematic collision is unavailable');
      world.forEachCollider(other=>{
        if(other.handle===entry.collider.handle||!other.isEnabled()||other.isSensor()||other.handle!==collider.handle&&!other.parent()?.isDynamic())return;
        const contact=other.contactShape(entry.collider.shape,at,rotation,0);
        if(contact&&contact.distance<-.005)throw new Error('Kinematic collision is occupied');
      });
      entry.body.setNextKinematicTranslation(at);entry.body.setNextKinematicRotation(rotation);
    },
    floorHeight(x,z,top,distance) {
      if(disposed)return undefined;
      Object.assign(floorRay.origin,{x,y:top,z});
      const hit=world.castRayAndGetNormal(floorRay,distance,true,RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC|RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,undefined,collider,undefined,probeThrough.size?floorFilter:undefined);
      return hit&&hit.normal.y>.45?top-hit.timeOfImpact:undefined;
    },
    fixedCollisionInBox(x,y,z,halfWidth,halfHeight) {
      if(disposed)return false;
      return !!world.intersectionWithShape({x,y,z},IDENTITY,new RAPIER.Cuboid(halfWidth,halfHeight,halfWidth),
        RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC|RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC|RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,undefined,collider);
    },
    removeStaticCollision(id) {
      if (disposed) return false;
      const moving=kinematicColliders.get(id);
      if(moving){kinematicColliders.delete(id);world.removeRigidBody(moving.body);stepWorld();syncPosition();return true;}
      const previous = staticColliders.get(id);
      if (!previous) return false;
      staticColliders.delete(id);
      forgetStatic(previous);
      world.removeCollider(previous, true);
      stepWorld(); syncPosition();
      return true;
    },
    addResource(options) { if (disposed) throw new Error('Player controller is disposed.'); return resources.add(options); },
    getResource(id) { return disposed ? undefined : resources.get(id); },
    fellResource(id, direction) { return resources.fell(id, direction); },
    collectResource(id) { return resources.collect(id); },
    restoreResource(id) { return resources.restore(id); },
    canRestoreResource(id) { return resources.canRestore(id); },
    removeResource(id) { return disposed ? false : resources.remove(id); },
    addVehicle(options) { if (disposed) throw new Error('Player controller is disposed.'); return vehicles.add(options); },
    getVehicle(id) { return disposed ? undefined : vehicles.get(id); },
    getVehicleState(id) { return disposed ? undefined : vehicles.get(id); },
    setVehicleInput(id, input) { const vehicle = vehicles.get(id); if (disposed || !vehicle) return false; vehicle.setInput(input); return true; },
    resetVehicle(id, at, rotation) {
      const vehicle = vehicles.get(id); if (disposed || !vehicle) return false;
      vehicle.reset(at, rotation);
      if (driving === vehicle) { vehicles.seatPosition(id, seat); placeFeet(seat); syncPosition(true); }
      return true;
    },
    removeVehicle(id) {
      if (disposed) return false;
      if (driving?.id === id) { cancelDriving(beforeDrivingPosition); syncPosition(true); }
      return vehicles.remove(id);
    },
    enterVehicle(id) {
      if (disposed) return { ok: false, reason: 'disposed' };
      if (driving || riding) return { ok: false, reason: 'already-driving' };
      const vehicle = vehicles.get(id);
      if (!vehicle) return { ok: false, reason: 'not-found' };
      vehicles.seatPosition(id, seat);
      if (position.distanceTo(seat) > 3.5) return { ok: false, reason: 'too-far' };
      if (vehicleMoving(vehicle, .8)) return { ok: false, reason: 'moving' };
      if (new THREE.Vector3(0, 1, 0).applyQuaternion(vehicle.quaternion).y < .35) return { ok: false, reason: 'blocked' };
      if (!pathClear(position, seat, vehicles.bodyFor(vehicle.id))) return { ok: false, reason: 'blocked' };
      beforeDrivingPosition.copy(position); savedAvatarVisible = avatar.object.visible;
      driving = vehicle; vehicle.setInput({ throttle: 0, steering: 0, brake: 1 });
      collider.setEnabled(false); avatar.object.visible = false; clearWalkingMotion(); placeFeet(seat); syncPosition(true);
      return { ok: true };
    },
    exitVehicle() {
      if (disposed) return { ok: false, reason: 'disposed' };
      if (!driving || driving.disposed) return { ok: false, reason: 'not-found' };
      const vehicle = driving;
      if (vehicleMoving(vehicle, 1)) return { ok: false, reason: 'moving' };
      const side = vehicle.config.width / 2 + CHARACTER_RADIUS + .35;
      const rear = vehicle.config.length / 2 + CHARACTER_RADIUS + .4;
      const candidates = [[side, 0], [-side, 0], [side, -.7], [-side, -.7], [0, -rear], [0, rear]];
      const from = vehicles.seatPosition(vehicle.id, seat)!;
      for (const [x, z] of candidates) {
        const point = new THREE.Vector3(x, 0, z).applyQuaternion(vehicle.quaternion).add(vehicle.position);
        const hit = world.castRayAndGetNormal(new RAPIER.Ray({ x: point.x, y: point.y + 2, z: point.z }, { x: 0, y: -1, z: 0 }), 4, true,
          RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, undefined, collider, vehicles.bodyFor(vehicle.id));
        if (!hit || hit.normal.y < .7) continue;
        point.y += 2 - hit.timeOfImpact + CONTACT_OFFSET;
        if (Math.abs(point.y - vehicle.position.y) > .7) continue;
        const center = point.clone().add(new THREE.Vector3(0, CHARACTER_HALF_HEIGHT, 0));
        let blocked = false;
        world.forEachCollider(other => {
          if (blocked || !other.isEnabled() || other.isSensor() || other.handle === collider.handle) return;
          const contact = other.contactShape(capsuleShape, center, IDENTITY, .005);
          if (contact && contact.distance <= .005) blocked = true;
        });
        if (blocked || !pathClear(from, point, vehicles.bodyFor(vehicle.id))) continue;
        cancelDriving(point); syncPosition(true); return { ok: true };
      }
      return { ok: false, reason: 'no-safe-exit' };
    },
    update(dt, direction, running, jump) {
      sprinting = false; landingSpeed = 0;
      if (disposed || !Number.isFinite(dt) || dt <= 0) { sprintEvidenceRemaining = 0; return; }
      const elapsed = Math.min(dt, 0.1);
      if (riding?.disposed) { cancelRide(beforeRidingPosition); syncPosition(true); }
      if (riding) {
        sprintEvidenceRemaining = 0; accumulator += elapsed;
        while (accumulator + 1e-9 >= FIXED_STEP) {
          stepWorld(); placeFeet(riding.position);
          accumulator = Math.max(0, accumulator - FIXED_STEP);
        }
        syncPosition(); present(elapsed);
        // A riding pose is applied by the visible ride controller; the walk
        // mixer must not reset its hand/foot IK after each physics frame.
        lastMotionSpeed = 0; motionAcceleration = 0;
        return;
      }
      if (driving?.disposed) { cancelDriving(beforeDrivingPosition); syncPosition(true); }
      if (driving) {
        hasBlockedWall = false;
        sprintEvidenceRemaining = 0; accumulator += elapsed;
        while (accumulator + 1e-9 >= FIXED_STEP) {
          stepWorld();
          vehicles.seatPosition(driving.id, seat); placeFeet(seat);
          accumulator = Math.max(0, accumulator - FIXED_STEP);
        }
        syncPosition(); present(elapsed);
        lastMotionSpeed = 0; motionAcceleration = 0;
        avatarModel?.updateMotion(elapsed, { speed: 0, distance: 0, grounded: false, sprinting: false,
          acceleration: 0, verticalSpeed: 0, landingSpeed: 0 });
        return;
      }
      if (jump && !jumpWasPressed) jumpBuffer = JUMP_BUFFER_SECONDS;
      jumpWasPressed = jump;
      movement.set(direction.x, 0, direction.z);
      if (!Number.isFinite(movement.lengthSq())) movement.set(0, 0, 0);
      if (movement.lengthSq() > 1) movement.normalize();
      // Spawn, teleport/correction and interactions may explicitly set facing.
      if (velocity.lengthSq() < .0001 && Math.abs(avatar.object.rotation.y - lastShownHeading) > 1e-6) {
        travelHeading = avatar.object.rotation.y;
      }
      if (!running || movement.lengthSq() <= .001 || !grounded || jump) {
        sprintEvidenceRemaining = 0;
      }
      accumulator += elapsed;
      let physicsSteps = 0;
      let frameSprinting = false;

      while (accumulator + 1e-9 >= FIXED_STEP) {
        sprintEvidenceRemaining = Math.max(0, sprintEvidenceRemaining - FIXED_STEP);
        const canRun = running && movement.lengthSq() > .001;
        const wasGrounded = grounded;
        const stepDistance = walkStep(canRun);
        const actualSprint = canRun && (wasGrounded || grounded) && stepDistance > .0005;
        frameSprinting ||= actualSprint;
        if (actualSprint) sprintEvidenceRemaining = SPRINT_EVIDENCE_SECONDS;
        physicsSteps++;
        accumulator = Math.max(0, accumulator - FIXED_STEP);
      }
      // Carry measured sprint motion briefly across collision corrections and
      // render frames between physics ticks so animation and footsteps agree.
      // Releasing input clears the evidence without waiting for a physics tick.
      if (!running || movement.lengthSq() <= .001 || !grounded || jump) {
        sprintEvidenceRemaining = 0;
      }
      sprinting = sprintEvidenceRemaining > 1e-9;
      syncPosition();
      shownVelocity.copy(renderedFeet);
      const travelled = present(elapsed);
      shownVelocity.subVectors(renderPosition, shownVelocity); shownVelocity.y = 0;
      const shownSpeed = travelled / elapsed;
      const acceleration = THREE.MathUtils.clamp((shownSpeed - lastMotionSpeed) / elapsed, -35, 35);
      motionAcceleration = THREE.MathUtils.damp(motionAcceleration, acceleration, 8, elapsed);
      lastMotionSpeed = shownSpeed;

      let turnRate = 0;
      if (travelled > .00005 || movement.lengthSq() > .001) {
        const heading = travelled > .00005 ? Math.atan2(shownVelocity.x, shownVelocity.z) : travelHeading;
        const delta = THREE.MathUtils.euclideanModulo(heading - avatar.object.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
        const limit = (grounded ? PIVOT_TURN_RATE : 4) * elapsed;
        const turn = THREE.MathUtils.clamp(delta, -limit, limit);
        avatar.object.rotation.y += turn;
        turnRate = turn / elapsed;
      }
      lastShownHeading = avatar.object.rotation.y;

      if (avatarModel) {
        // Gait follows the displayed feet: blended motion advances the foot
        // phase evenly on every frame, and a blocked capsule stays planted.
        avatarModel.updateMotion(elapsed, { speed: shownSpeed, distance: travelled, grounded,
          sprinting: sprinting && (frameSprinting || !physicsSteps), turnRate,
          acceleration: motionAcceleration, verticalSpeed, landingSpeed });
      } else if (fallbackAvatar) {
        const moving = grounded && travelled > 0.0005;
        animationWeight = THREE.MathUtils.damp(animationWeight, moving ? 1 : 0, 14, elapsed);
        animationPhase += travelled * 5;
        const stride = Math.sin(animationPhase) * (sprinting ? 0.65 : 0.45) * animationWeight;
        fallbackAvatar.limbs[0].rotation.x = stride;
        fallbackAvatar.limbs[1].rotation.x = -stride * 0.8;
        fallbackAvatar.limbs[2].rotation.x = -stride;
        fallbackAvatar.limbs[3].rotation.x = stride * 0.8;
        fallbackAvatar.body.position.y = Math.abs(Math.sin(animationPhase * 2)) * 0.025 * animationWeight;
      }
    },
    teleport(feet) {
      if (disposed) return;
      if (!feet.toArray().every(Number.isFinite)) return;
      if (riding) cancelRide(feet);
      if (driving) cancelDriving(feet);
      placeFeet(feet);
      stepWorld();
      verticalSpeed = 0;
      velocity.set(0, 0, 0);
      hasBlockedWall = false;
      lastMotionSpeed = 0; motionAcceleration = 0; travelHeading = avatar.object.rotation.y;
      grounded = false;
      sprinting = false;
      sprintEvidenceRemaining = 0;
      accumulator = 0;
      jumpBuffer = 0;
      coyoteRemaining = 0;
      stepSupportRemaining = 0;
      groundNormal.set(0, 1, 0);
      syncPosition(true);
    },
    constrainCamera(target, desired) {
      constrainedCamera.copy(desired);
      if (disposed) return constrainedCamera;
      cameraDirection.subVectors(desired, target);
      const distance = cameraDirection.length();
      if (distance < 0.001) return constrainedCamera;
      cameraDirection.divideScalar(distance);
      // A sphere, not a ray: a lens grazing a corner or door frame would
      // otherwise put its near plane through the wall.
      const exclude = riding?.body ?? (driving ? vehicles.bodyFor(driving.id) : undefined);
      const cast = (from: THREE.Vector3, reach: number) => world.castShape(from, IDENTITY, cameraDirection, cameraProbe, 0, reach, true, SOLID, undefined, collider, exclude, cameraObstacle);
      const lane = (from: THREE.Vector3, reach: number) => {
        cameraLane.origin.x = from.x; cameraLane.origin.y = from.y; cameraLane.origin.z = from.z;
        cameraLane.dir.x = cameraDirection.x; cameraLane.dir.y = cameraDirection.y; cameraLane.dir.z = cameraDirection.z;
        return world.castRay(cameraLane, reach, true, SOLID, undefined, collider, exclude, cameraObstacle);
      };
      // A post is not a wall: a sign pole or lamp post crossing the arm would snap the lens onto the
      // player's back for a frame and let it spring out the next. Where there is free space beside it on
      // both sides the obstacle is a post, and the lens stays behind it.
      const upright = Math.abs(cameraDirection.y) < .95;
      if (upright) cameraSide.set(-cameraDirection.z, 0, cameraDirection.x).normalize().multiplyScalar(CAMERA_POST_CLEARANCE);
      let passed = 0, hit = cast(target, distance);
      for (let posts = 0; hit && upright && posts < 4; posts++) {
        const at = passed + hit.time_of_impact, beyond = at + CAMERA_POST_DEPTH;
        if (beyond >= distance) break;
        // Only the stretch beside this obstacle has to be clear; the next post along is judged on its own.
        const back = Math.min(at, .1);
        if (lane(cameraStart.copy(target).addScaledVector(cameraDirection, at - back).add(cameraSide), back + CAMERA_POST_DEPTH)
          || lane(cameraStart.copy(target).addScaledVector(cameraDirection, at - back).sub(cameraSide), back + CAMERA_POST_DEPTH)) break;
        const next = cast(cameraStart.copy(target).addScaledVector(cameraDirection, beyond), distance - beyond);
        // Still inside it a post's depth further on: a fence or fin seen end-on, not a post.
        if (next && next.time_of_impact < .01) break;
        passed = beyond; hit = next;
      }
      if (hit) constrainedCamera.copy(target).addScaledVector(cameraDirection, Math.max(0, passed + hit.time_of_impact - .02));
      return constrainedCamera;
    },
    attachPhysics(create) {
      if (disposed) throw new Error('Player controller is disposed.');
      const attachment = create(world, collider);
      attachments.add(attachment);
      if (attachment.passable) attachmentFilter = walkable;
      return attachment;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      riding?.park(); riding = undefined;
      sprinting = false;
      sprintEvidenceRemaining = 0;
      for (const attachment of attachments) attachment.dispose?.();
      attachments.clear(); attachmentFilter = undefined;
      resources.dispose(); vehicles.dispose(); driving = undefined;
      staticColliders.clear(); probeThrough.clear(); cameraThrough.clear();
      world.removeCharacterController(controller);
      collisionBaker.dispose();
      world.free();
      avatar.object.removeFromParent();
      if (avatarModel) { avatarModel.dispose(); return; }
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      avatar.object.traverse((part) => {
        if (!(part instanceof THREE.Mesh)) return;
        geometries.add(part.geometry);
        for (const material of Array.isArray(part.material) ? part.material : [part.material]) materials.add(material);
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
