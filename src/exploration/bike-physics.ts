import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsAttachment, RidingActor } from './player.ts';

/** Positive steering turns local +Z toward +X. Inputs are commands, not velocities. */
export interface BikeInput { throttle: number; steering: number; brake: number }
export interface BikeConfig {
  mass: number; wheelBase: number; wheelRadius: number; width: number; length: number;
  maxSpeed: number; reverseSpeed: number; acceleration: number; braking: number;
  /** Cornering limit in m/s². Above it the steering lock closes instead of the tyres sliding. */
  lateralGrip: number;
}
export const DEFAULT_BIKE_CONFIG: Readonly<BikeConfig> = Object.freeze({
  mass: 105, wheelBase: 1.092, wheelRadius: .347968, width: .565, length: 1.788,
  maxSpeed: 7.5, reverseSpeed: 1.2, acceleration: 2.8, braking: 5.4, lateralGrip: 14,
});
export interface BikeOptions { position: THREE.Vector3; yaw?: number; scale?: number; config?: Partial<BikeConfig> }
export interface BikeRenderState {
  position: THREE.Vector3; quaternion: THREE.Quaternion;
  lean: number; pitch: number; steering: number; wheelRotation: number; pedalPhase: number;
}
export interface BikePhysics extends PhysicsAttachment, RidingActor {
  readonly config: BikeConfig;
  readonly render: BikeRenderState;
  readonly speedKph: number;
  readonly steering: number;
  readonly wheelRotation: number;
  readonly pedalPhase: number;
  readonly lean: number;
  readonly pitch: number;
  readonly grounded: boolean;
  readonly braking: number;
  setInput(input: Partial<BikeInput>): void;
  /** Remove all queued throttle/steer immediately, including input smoothing. */
  park(): void;
  canPlace(position: THREE.Vector3, yaw?: number): boolean;
  reset(position?: THREE.Vector3, yaw?: number): boolean;
  dispose(): void;
}
const UP = new THREE.Vector3(0, 1, 0), ZERO = { x: 0, y: 0, z: 0 };
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const command = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? THREE.MathUtils.clamp(value, min, max) : 0;
const finitePosition = (value: THREE.Vector3) => value.toArray().every(n => Number.isFinite(n) && Math.abs(n) < 1e6);

/**
 * An assisted bicycle in the player's existing Rapier world. Two ray springs
 * provide road support and carry the wheels over kerbs and grade changes; the
 * frame and raised tyre shapes catch walls, posts and anything taller.
 * Automatic balance locks physical roll/pitch, while the display banks into a
 * corner. All steering and acceleration are fixed-step forces/velocities:
 * neither the camera nor a render frame translates the collision body.
 */
export function createBikePhysics(world: RAPIER.World, playerCollider: RAPIER.Collider, options: BikeOptions): BikePhysics {
  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale < .5 || scale > 1.5) throw new Error('Invalid bicycle scale');
  const config = { ...DEFAULT_BIKE_CONFIG, ...options.config };
  for (const key of ['wheelBase', 'wheelRadius', 'width', 'length'] as const) config[key] *= scale;
  if (!finitePosition(options.position) || !Number.isFinite(options.yaw ?? 0)) throw new Error('Invalid bicycle spawn');
  if (!Object.values(config).every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid bicycle configuration');
  const spawn = options.position.clone(), spawnYaw = options.yaw ?? 0;
  const position = spawn.clone(), quaternion = new THREE.Quaternion().setFromAxisAngle(UP, spawnYaw);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...position.toArray())
    .setRotation(quaternion).enabledRotations(false, true, false)
    .setGravityScale(9.81 / Math.max(.01, Math.abs(world.gravity.y)))
    .setCcdEnabled(true).setSoftCcdPrediction(.12).setLinearDamping(.015).setAngularDamping(.3)
    .setAdditionalMassProperties(config.mass, { x: 0, y: .55 * scale, z: 0 }, { x: 35 * scale ** 2, y: 30 * scale ** 2, z: 20 * scale ** 2 }, IDENTITY));
  const shapes = [
    { shape: new RAPIER.Cuboid(.19 * scale, .29 * scale, .54 * scale), at: new THREE.Vector3(0, .57 * scale, 0) },
    { shape: new RAPIER.Cuboid(config.width / 2, .065 * scale, .09 * scale), at: new THREE.Vector3(0, 1.03 * scale, .40 * scale) },
    // The body stays level while the road tilts under it, so a tyre-sized
    // ball would rest on every grade and catch each seam of the road mesh.
    // These guards clear the ground by 19 cm: the springs own the road.
    ...[1, -1].map(side => ({ shape: new RAPIER.Ball(config.wheelRadius * .6), at: new THREE.Vector3(0, .19 * scale + config.wheelRadius * .6, side * (config.wheelBase / 2 + config.wheelRadius * .36)) })),
  ];
  for (const entry of shapes) world.createCollider(new RAPIER.ColliderDesc(entry.shape)
    .setTranslation(...entry.at.toArray()).setMass(0).setFriction(.02).setRestitution(0), body);
  const riderShape = { shape: new RAPIER.Capsule(.30 * scale, .17 * scale), at: new THREE.Vector3(0, 1.20 * scale, -.12 * scale) };
  const riderCollider = world.createCollider(new RAPIER.ColliderDesc(riderShape.shape)
    .setTranslation(...riderShape.at.toArray()).setMass(0).setFriction(.05).setRestitution(0), body);
  riderCollider.setEnabled(false);
  // A newly created zero-density compound has deferred mass properties. The
  // first spring query can already touch the road, so resolve its mass now.
  body.recomputeMassPropertiesFromColliders();
  const suspension = world.createVehicleController(body);
  suspension.indexUpAxis = 1; suspension.setIndexForwardAxis = 2;
  const stiffness = 65 / scale, restLength = .16 * scale;
  const connectionHeight = config.wheelRadius + restLength - 9.81 / (2 * stiffness);
  for (const side of [1, -1]) {
    const index = side === 1 ? 0 : 1;
    suspension.addWheel({ x: 0, y: connectionHeight, z: side * config.wheelBase / 2 }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, restLength, config.wheelRadius);
    suspension.setWheelSuspensionStiffness(index, stiffness);
    suspension.setWheelSuspensionCompression(index, 7);
    suspension.setWheelSuspensionRelaxation(index, 9);
    suspension.setWheelMaxSuspensionTravel(index, .22);
    suspension.setWheelMaxSuspensionForce(index, config.mass * 9.81 * 2.5);
    // Lateral/longitudinal grip is an explicit force below, independent of the
    // engine/brake impulse conventions of Rapier's four-wheel car controller.
    suspension.setWheelFrictionSlip(index, 0);
    suspension.setWheelSideFrictionStiffness(index, 0);
  }
  let disposed = false, input: BikeInput = { throttle: 0, steering: 0, brake: 1 };
  let speed = 0, steering = 0, wheelRotation = 0, pedalPhase = 0, lean = 0, pitch = 0;
  let acceleration = 0, yawRate = 0, grounded = false, brake = 1, reverseWait = 0;
  let parkingRest = 0;
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), velocity = new THREE.Vector3(), force = new THREE.Vector3();
  let lateralSlope = 0, forwardSlope = 0, supports = 0;
  const previous = { position: position.clone(), quaternion: quaternion.clone(), lean: 0, pitch: 0, wheelRotation: 0, pedalPhase: 0, steering: 0 };
  const render: BikeRenderState = { ...previous, position: position.clone(), quaternion: quaternion.clone() };
  const included = (other: RAPIER.Collider) => other.handle !== playerCollider.handle && other.parent()?.handle !== body.handle;
  const validPlacement = (at: THREE.Vector3, yaw: number) => {
    if (disposed || !finitePosition(at) || !Number.isFinite(yaw)) return false;
    const rotation = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const floor = world.castRayAndGetNormal(new RAPIER.Ray({ x: at.x, y: at.y + .45, z: at.z }, { x: 0, y: -1, z: 0 }), .8, true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, playerCollider, body);
    if (!floor || floor.normal.y < .7 || Math.abs(.45 - floor.timeOfImpact) > .22) return false;
    let clear = true;
    for (const entry of riderCollider.isEnabled() ? [...shapes, riderShape] : shapes) {
      const center = entry.at.clone().applyQuaternion(rotation).add(at);
      world.forEachCollider(other => {
        if (!clear || !included(other) || !other.isEnabled() || other.isSensor()) return;
        const contact = other.contactShape(entry.shape, center, rotation, .01);
        if (contact && contact.distance < -.004) clear = false;
      });
    }
    return clear;
  };
  const bike: BikePhysics = {
    config, body, position, quaternion, render,
    get disposed() { return disposed; }, get speedMps() { return speed; }, get speedKph() { return speed * 3.6; },
    get steering() { return steering; }, get wheelRotation() { return wheelRotation; }, get pedalPhase() { return pedalPhase; },
    get lean() { return lean; }, get pitch() { return pitch; }, get grounded() { return grounded; }, get braking() { return brake; },
    setInput(value) {
      if (disposed) return;
      const wasParked = input.brake > .9 && !input.throttle;
      input = { throttle: command(value.throttle, -1, 1), steering: command(value.steering, -1, 1), brake: command(value.brake, 0, 1) };
      if (input.throttle || input.steering || wasParked && input.brake < .9) { body.wakeUp(); parkingRest = 0; }
    },
    park() {
      input = { throttle: 0, steering: 0, brake: 1 };
      acceleration = 0; yawRate = 0; reverseWait = 0; steering = 0;
    },
    setRiderEnabled(enabled) { if (!disposed) riderCollider.setEnabled(enabled); },
    canPlace(at, yaw = spawnYaw) { return validPlacement(at, yaw); },
    reset(at = spawn, yaw = spawnYaw) {
      if (!validPlacement(at, yaw)) return false;
      this.park(); quaternion.setFromAxisAngle(UP, yaw); position.copy(at);
      body.setTranslation(at, true); body.setRotation(quaternion, true); body.setLinvel(ZERO, true); body.setAngvel(ZERO, true);
      body.resetForces(true); body.resetTorques(true); world.propagateModifiedBodyPositionsToColliders();
      speed = 0; lean = 0; pitch = 0; wheelRotation = 0; pedalPhase = 0;
      parkingRest = 0;
      previous.position.copy(position); previous.quaternion.copy(quaternion);
      previous.lean = previous.pitch = previous.steering = previous.wheelRotation = previous.pedalPhase = 0;
      this.interpolate?.(1); return true;
    },
    beforeStep(dt) {
      if (disposed) return;
      // A settled parking brake lets Rapier sleep the dynamic body. A genuine
      // collision wakes it normally; suspension solver noise cannot creep it
      // along a slight grade for minutes while nobody is riding.
      if (body.isSleeping() && input.brake > .9 && !input.throttle) return;
      quaternion.copy(body.rotation()); velocity.copy(body.linvel());
      forward.set(0, 0, 1).applyQuaternion(quaternion); right.set(1, 0, 0).applyQuaternion(quaternion);
      speed = velocity.dot(forward);
      const absSpeed = Math.abs(speed), highSpeed = THREE.MathUtils.smoothstep(absSpeed, 1.5, config.maxSpeed);
      const targetSteering = input.steering * THREE.MathUtils.lerp(.58, .22, highSpeed);
      steering = THREE.MathUtils.damp(steering, targetSteering, input.steering ? 9 : 7, dt);
      // S first brakes forward motion, then pauses before pushing backwards.
      if (input.throttle < 0 && speed < .18) reverseWait += dt; else reverseWait = 0;
      const reversing = input.throttle < 0 && (speed > .18 || reverseWait < .3);
      const changingToForward = input.throttle > 0 && speed < -.15;
      brake = Math.max(input.brake, reversing || changingToForward ? 1 : 0);
      // Road grade under the wheels: positive forwardSlope falls away ahead.
      lateralSlope = 0; forwardSlope = 0; supports = 0;
      for (let wheel = 0; wheel < 2; wheel++) {
        const normal = suspension.wheelContactNormal(wheel);
        if (!suspension.wheelIsInContact(wheel) || !normal || normal.y < .6) continue;
        lateralSlope += (normal.x * right.x + normal.z * right.z) / normal.y;
        forwardSlope += (normal.x * forward.x + normal.z * forward.z) / normal.y; supports++;
      }
      if (supports) { lateralSlope /= supports; forwardSlope /= supports; }
      const gradeAcceleration = 9.81 * forwardSlope;
      let targetAcceleration = 0;
      if (brake > .01) targetAcceleration = -Math.sign(speed) * Math.min(config.braking * brake, absSpeed / dt);
      // The motor answers a climb, so a hill costs a little pace instead of most of it.
      else if (input.throttle > 0) targetAcceleration = (config.acceleration + THREE.MathUtils.clamp(-gradeAcceleration, 0, 2.4)) * input.throttle * THREE.MathUtils.clamp((config.maxSpeed - speed) / 1.2, 0, 1);
      else if (input.throttle < 0) targetAcceleration = -1.6 * -input.throttle * THREE.MathUtils.clamp((config.reverseSpeed + speed) / .6, 0, 1);
      else targetAcceleration = -Math.sign(speed) * Math.min(.22 + absSpeed * .045, absSpeed / dt);
      // A descent cannot run away past the top speed the server also expects.
      if (brake <= .01 && speed > config.maxSpeed) targetAcceleration = Math.min(targetAcceleration, -(speed - config.maxSpeed) * 4 - Math.max(0, gradeAcceleration));
      acceleration += THREE.MathUtils.clamp(targetAcceleration - acceleration, -(brake > 0 ? 24 : 10) * dt, 10 * dt);
      if (brake > 0 && Math.abs(acceleration * dt) > absSpeed) acceleration = -speed / dt;
      const contact = suspension.wheelIsInContact(0) || suspension.wheelIsInContact(1);
      const yawLimit = Math.min(1.65, config.lateralGrip / Math.max(1, absSpeed));
      const targetYaw = contact ? THREE.MathUtils.clamp(speed * Math.tan(steering) / config.wheelBase, -yawLimit, yawLimit) : 0;
      yawRate = THREE.MathUtils.damp(yawRate, targetYaw, 10, dt);
      body.setAngvel({ x: 0, y: yawRate, z: 0 }, false);
      body.resetForces(false);
      if (contact) {
        const lateral = velocity.dot(right);
        force.copy(forward).multiplyScalar(acceleration * config.mass);
        force.addScaledVector(right, -THREE.MathUtils.clamp(lateral * 11, -10, 10) * config.mass);
        if (supports) {
          // Static tyre grip holds a traverse instead of slowly sliding down a
          // cambered street. Brakes also balance the grade when parked.
          force.addScaledVector(right, -9.81 * config.mass * lateralSlope);
          if (brake > .1) force.addScaledVector(forward, -9.81 * config.mass * forwardSlope * brake);
        }
        body.addForce(force, false);
      }
      suspension.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, included);
    },
    afterStep(dt) {
      if (disposed) return;
      previous.position.copy(position); previous.quaternion.copy(quaternion);
      previous.lean = lean; previous.pitch = pitch; previous.wheelRotation = wheelRotation; previous.pedalPhase = pedalPhase; previous.steering = steering;
      position.copy(body.translation()); quaternion.copy(body.rotation()); forward.set(0, 0, 1).applyQuaternion(quaternion);
      speed = velocity.copy(body.linvel()).dot(forward);
      grounded = suspension.wheelIsInContact(0) || suspension.wheelIsInContact(1);
      wheelRotation += (position.x - previous.position.x) * forward.x / config.wheelRadius
        + (position.z - previous.position.z) * forward.z / config.wheelRadius;
      if (grounded && input.brake > .9 && !input.throttle && Math.hypot(velocity.x, velocity.z) < .04 && Math.abs(velocity.y) < .10) {
        parkingRest += dt;
        if (parkingRest > .2) { body.sleep(); speed = 0; acceleration = 0; yawRate = 0; }
      } else parkingRest = 0;
      // Pedalling fades naturally into coasting; reverse never pedals backwards.
      if (input.throttle > 0 && brake < .05 && speed > .15 && grounded) pedalPhase += Math.min(8, speed / config.wheelRadius / 2.7) * dt;
      lean = THREE.MathUtils.damp(lean, grounded ? THREE.MathUtils.clamp(-Math.atan(speed * yawRate / 9.81), -.35, .35) : 0, 7, dt);
      // The balanced body stays upright. A hill can extend one suspension ray
      // beyond contact; independent road probes still give the visual frame
      // the correct slope without making it pitch with every solver impulse.
      const ground = [1, -1].map(side => {
        const at = new THREE.Vector3(0, .8 * scale, side * config.wheelBase / 2).applyQuaternion(quaternion).add(position);
        const hit = world.castRayAndGetNormal(new RAPIER.Ray(at, { x: 0, y: -1, z: 0 }), 1.5 * scale, true,
          RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, playerCollider, body);
        return hit && hit.normal.y > .6 ? at.y - hit.timeOfImpact : undefined;
      });
      const slope = grounded && ground[0] !== undefined && ground[1] !== undefined ? -Math.atan2(ground[0] - ground[1], config.wheelBase) : 0;
      pitch = THREE.MathUtils.damp(pitch, THREE.MathUtils.clamp(slope, -.4, .4), 10, dt);
    },
    interpolate(alpha) {
      if (disposed) return;
      const t = THREE.MathUtils.clamp(alpha, 0, 1);
      render.position.lerpVectors(previous.position, position, t); render.quaternion.slerpQuaternions(previous.quaternion, quaternion, t);
      render.lean = THREE.MathUtils.lerp(previous.lean, lean, t); render.pitch = THREE.MathUtils.lerp(previous.pitch, pitch, t);
      render.wheelRotation = THREE.MathUtils.lerp(previous.wheelRotation, wheelRotation, t);
      render.pedalPhase = THREE.MathUtils.lerp(previous.pedalPhase, pedalPhase, t); render.steering = steering;
    },
    dispose() { if (disposed) return; disposed = true; world.removeVehicleController(suspension); world.removeRigidBody(body); },
  };
  return bike;
}
