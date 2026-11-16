import { Euler, MathUtils, Quaternion, Vector3, type PerspectiveCamera } from "three";
import type { VRInput } from "./xr.ts";

/**
 * A very simple free-flight camera: point the nose with the mouse (or by pointing a phone),
 * thrust with W / S, strafe with A / D, roll with Q / E, and boost with Shift. On touch
 * screens, holding a finger anywhere on the scene boosts.
 *
 * Steering is relative to the ship, like a cockpit: after rolling, "up" on the mouse still
 * pitches towards the top of the screen. There's no up or down in space, so no limits.
 *
 * In VR the headset looks around inside the ship: thrust goes where you look, and the right
 * thumbstick turns the ship itself (see `xr.ts`).
 */

/** Units per second² of thrust, and how quickly speed bleeds off (per second). */
/** How quickly speed bleeds off when not thrusting (per second). */
const DRAG = 0.8;
/** Top speeds in units per second (the Earth is 8 units across) in open space. */
const CRUISE_SPEED = 20;
const BOOST_SPEED = 80;
/**
 * Speed scales with the gap to the nearest surface, like the throttle of a ship in a space
 * sim: crawling near a planet so it towers overhead, racing across the empty space between.
 *
 * Low down, top speed is proportional to the gap: SPEED_GAP / CRUISE_SPEED is how many seconds
 * the ship takes to cover its own height above a surface, which is what sets how big the ship
 * feels (too quick and it seems a giant skimming a ball). Twelve seconds cruising (three on
 * boost) keeps it small next to the planets.
 *
 * Higher up, where that cue fades, speed grows with the square of the gap instead, from a
 * height of CLIMB_HEIGHT × the body's radius. Being relative to the body, climbing away to full
 * speed takes the same time at every planet and moon (about 20 s on boost from skimming the
 * surface, about 1 s from a radius up).
 */
const SPEED_GAP = 240;
const CLIMB_HEIGHT = 0.19;
// Near a surface the ship crawls (~5 km/s cruising low over the Earth), so planets feel
// enormous; far from everything it can outrun light (~1.8 c on boost).
const MIN_SPEED_SCALE = 0.0001;
const MAX_SPEED_SCALE = 4.2;

/**
 * What top speed is multiplied by at `gap` units from the surface of the nearest body, whose
 * radius is `radius`.
 */
export const speedScale = (gap: number, radius: number): number =>
  MathUtils.clamp(
    (gap / SPEED_GAP) * (1 + gap / (radius * CLIMB_HEIGHT)),
    MIN_SPEED_SCALE,
    MAX_SPEED_SCALE,
  );
/** How fast excess speed bleeds off when the limit drops (per second), so you can't crash. */
const OVERSPEED_DRAG = 3;
/**
 * Heading straight away from the nearest body, the speed limit is this many times higher and
 * speed builds this many times faster, so climbing off a surface takes seconds (~6 s from
 * skimming it to full boost, rather than ~20 s) while approaching and skimming stay slow.
 * Partly away gets part of the lift.
 */
const LEAVE_SPEEDUP = 4;
const LEAVE_RESPONSE = 3;
/**
 * Out in open space, speed builds (and bleeds off) this much as quickly, for a heavier feel
 * between the planets. It blends in from OPEN_SPACE_FROM to OPEN_SPACE_TO radii above the
 * nearest body; closer in, the ship stays nimble.
 */
const OPEN_SPACE_RESPONSE = 0.6;
const OPEN_SPACE_FROM = 1;
const OPEN_SPACE_TO = 4;
/** Radians of turn per pixel of mouse movement or drag. */
const MOUSE_SENSITIVITY = 0.0025;
/**
 * With the mouse captured (desktop), it works a flight stick rather than turning the view
 * directly: moving it deflects the stick (up to full deflection), the stick sets a turn rate
 * (up to STICK_TURN_RATE), the ship's turn eases towards that rate (STICK_RESPONSE, per second)
 * and the stick drifts back to centre (STICK_RECENTER, per second). Small moves turn about as
 * far as before, but a fast flick can't whip the view round (a big flick turns ~50°, not
 * ~140°; keeping the mouse moving turns at most ~80°/s), and the ship swings into and out of
 * each turn.
 */
const STICK_TURN_RATE = 1.4;
const STICK_RECENTER = 1.8;
const STICK_RESPONSE = 4;
/** Stick deflection per pixel, so a small move turns ~MOUSE_SENSITIVITY radians per pixel. */
const STICK_PER_PIXEL = (MOUSE_SENSITIVITY * STICK_RECENTER) / STICK_TURN_RATE;
const TOUCH_SENSITIVITY = 0.005;
/** A finger must move this far (CSS px) before it steers, so resting it to boost doesn't. */
const DRAG_THRESHOLD = 8;
/** Arrow keys turn, and Q / E roll, at these rates (radians per second). */
const KEY_TURN_RATE = 1.2;
const ROLL_RATE = 1.6;
/** The VR turn stick, at full deflection (radians per second). */
const VR_TURN_RATE = 1.5;
/** Stay within this distance of the Earth: far enough to reach the nebulae, not to get lost. */
export const MAX_RANGE = 3000;
/**
 * Keep this far above a body's surface: a fraction of its radius (just clear of the Earth's
 * atmosphere), but never less than a fixed gap. The scene shrinks the camera's near plane as
 * the ship gets close (see `nearestGap`), so surfaces never get sliced.
 */
// ~64 km above the Earth: inside its atmosphere, but above the cloud layer (~38 km).
const CLEARANCE = 0.01;
const MIN_GAP = 0.012;

/**
 * How far above the surface of a body of this radius the camera may come: the ship's closest
 * approach, and the furthest explore mode zooms in.
 */
export const surfaceClearance = (radius: number): number => Math.max(radius * CLEARANCE, MIN_GAP);

/**
 * How far along the path `from` → `to` (0–1) it first enters the sphere, or null if it doesn't.
 * A path that starts inside, or is moving away, isn't a hit (the push-out handles those).
 */
export const sweepSphere = (
  from: Vector3,
  to: Vector3,
  centre: Vector3,
  radius: number,
): number | null => {
  // Solve |from + t·move − centre|² = radius² for the smaller root.
  const mx = to.x - from.x;
  const my = to.y - from.y;
  const mz = to.z - from.z;
  const a = mx * mx + my * my + mz * mz;
  if (a === 0) return null;
  const fx = from.x - centre.x;
  const fy = from.y - centre.y;
  const fz = from.z - centre.z;
  const b = fx * mx + fy * my + fz * mz;
  const c = fx * fx + fy * fy + fz * fz - radius * radius;
  if (c <= 0 || b >= 0) return null;
  const discriminant = b * b - a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t <= 1 ? t : null;
};

export interface Obstacle {
  radius: number;
  getPosition: (out: Vector3) => Vector3;
}

const FLIGHT_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyQ",
  "KeyE",
  "ShiftLeft",
  "ShiftRight",
]);

/**
 * Smoothing for phone pointing, in "how much of the gap closes per second" (higher = snappier).
 * Small wobbles (hand tremor) get the slow rate and melt away; deliberate turns larger than
 * SMOOTH_ANGLE get the fast rate, so looking around still feels immediate.
 */
const SMOOTH_SLOW = 5;
const SMOOTH_FAST = 25;
const SMOOTH_ANGLE = MathUtils.degToRad(8);

/** The device's back camera looks out of the screen's back, not its top edge: −90° about x. */
const SCREEN_TO_CAMERA = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const deviceEuler = new Euler();
const screenTurn = new Quaternion();

/**
 * Which way a camera "looking through" the phone faces, from DeviceOrientation angles
 * (degrees) and the screen's rotation. The frame is the device's own (y up, arbitrary
 * compass); only changes relative to a starting pose are used, so that doesn't matter.
 */
export const deviceQuaternion = (
  alpha: number,
  beta: number,
  gamma: number,
  screenAngle: number,
  out: Quaternion,
): Quaternion => {
  const toRad = MathUtils.degToRad;
  // The spec's intrinsic Z-X'-Y'' angles, rewritten for a y-up frame.
  deviceEuler.set(toRad(beta), toRad(alpha), -toRad(gamma), "YXZ");
  return out
    .setFromEuler(deviceEuler)
    .multiply(SCREEN_TO_CAMERA)
    .multiply(screenTurn.setFromAxisAngle(Z_AXIS, -toRad(screenAngle)));
};

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

export class FlightController {
  readonly #camera: PerspectiveCamera;
  readonly #canvas: HTMLCanvasElement;
  readonly #obstacles: () => Iterable<Obstacle>;
  readonly #keys = new Set<string>();
  readonly #velocity = new Vector3();
  readonly #forward = new Vector3();
  readonly #right = new Vector3();
  readonly #thrust = new Vector3();
  readonly #scratch = new Vector3();
  readonly #from = new Vector3();
  readonly #move = new Vector3();
  readonly #outward = new Vector3();
  /** The ship's orientation (the camera's), turned about its own axes. */
  readonly #orientation = new Quaternion();
  readonly #step = new Quaternion();
  readonly #heading = new Quaternion();
  /** VR controller input and where the headset looks, relative to the ship; null outside VR. */
  #vr: { input: VRInput; gaze: Quaternion } | null = null;

  #active = false;
  /** Whether this flight wants the mouse captured (not where VR needs it free). */
  #wantsLock = false;
  /** Distance to the nearest body's surface, as of the last update. */
  #nearestGap = Infinity;
  /** Radius and centre of the body that gap is to. */
  #nearestRadius = 1;
  readonly #nearestCentre = new Vector3();
  #abort: AbortController | null = null;
  /** Fingers held on the scene (touch): holding anywhere boosts. */
  readonly #touches = new Set<number>();
  /** On-screen roll buttons (touch). */
  #rollLeft = false;
  #rollRight = false;
  /** The mouse's flight stick (x yaws right, y pitches up; within the unit circle). */
  readonly #stick = { x: 0, y: 0 };
  /** The ship's current turn from the stick (radians per second). */
  readonly #stickTurn = { yaw: 0, pitch: 0 };
  /**
   * Pointing the phone (VR-style "magic window"): the ship faces `reference × device`, where
   * `device` is the phone's latest orientation. `reference` is fixed when tracking starts so the
   * view doesn't jump, and shifts when dragging or rolling so those add on top.
   * `device` eases towards the latest sensor reading (`#deviceTarget`) to smooth out shake.
   * Null until the device reports its orientation (never, on most desktops).
   */
  #device: Quaternion | null = null;
  readonly #deviceTarget = new Quaternion();
  readonly #reference = new Quaternion();
  readonly #inverse = new Quaternion();
  /** A finger or mouse button dragging to steer (when the pointer isn't locked). */
  #drag: {
    id: number;
    x: number;
    y: number;
    sensitivity: number;
    /** Touch drags wait for DRAG_THRESHOLD of movement before steering. */
    steering: boolean;
  } | null = null;

  constructor(
    camera: PerspectiveCamera,
    canvas: HTMLCanvasElement,
    obstacles: () => Iterable<Obstacle>,
  ) {
    this.#camera = camera;
    this.#canvas = canvas;
    this.#obstacles = obstacles;
  }

  get active(): boolean {
    return this.#active;
  }

  /** Current speed, in world units per second. */
  get speed(): number {
    return this.#active ? this.#velocity.length() : 0;
  }

  /** Distance from the camera to the nearest body's surface (world units). */
  get nearestGap(): number {
    return this.#nearestGap;
  }

  /**
   * Take over the camera from where it is now, facing the same way. The mouse is captured
   * straight away where allowed (this runs from a click), unless `lockPointer` is false.
   */
  start({ lockPointer = true } = {}): void {
    if (this.#active) return;
    this.#active = true;
    this.#orientation.copy(this.#camera.quaternion);
    this.#velocity.set(0, 0, 0);
    this.#centreStick();
    this.#device = null;
    this.#bind();
    this.#wantsLock = lockPointer && matchMedia("(pointer: fine)").matches;
    if (this.#wantsLock) this.#lockPointer();
  }

  /** Steer with VR controllers and the headset instead of the mouse or phone. */
  setVR(on: boolean): void {
    if (!on) {
      this.#vr = null;
      return;
    }
    this.#vr = { input: { thrust: 0, strafe: 0, turn: 0, boost: false }, gaze: new Quaternion() };
    // The headset does the looking now.
    this.#device = null;
    this.#centreStick();
    this.#drag = null;
    if (document.pointerLockElement === this.#canvas) document.exitPointerLock();
  }

  /** This frame's VR input, and the headset's orientation relative to the ship. */
  setVRInput(input: VRInput, gaze: Quaternion): void {
    if (!this.#vr) return;
    this.#vr.input = input;
    this.#vr.gaze.copy(gaze);
  }

  stop(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#abort?.abort();
    this.#abort = null;
    this.#keys.clear();
    this.#touches.clear();
    this.#centreStick();
    this.#rollLeft = false;
    this.#rollRight = false;
    this.#drag = null;
    this.#vr = null;
    if (document.pointerLockElement === this.#canvas) document.exitPointerLock();
  }

  /** Hold-to-roll buttons (touch): -1 rolls left, +1 rolls right. */
  setRoll(direction: -1 | 1, on: boolean): void {
    if (direction < 0) this.#rollLeft = on;
    else this.#rollRight = on;
  }

  /** A point straight ahead, for handing the camera back to the orbit controls. */
  pointAhead(distance: number, out: Vector3): Vector3 {
    return out.copy(this.#camera.position).addScaledVector(this.#direction(), distance);
  }

  update(delta: number): void {
    if (!this.#active) return;
    const keys = this.#keys;
    this.#followDevice(delta);

    // Steering: arrow keys, roll and the captured mouse (a flight stick) turn at a rate;
    // dragging and device pointing are direct.
    const keyYaw = (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
    const keyPitch = (keys.has("ArrowUp") ? 1 : 0) - (keys.has("ArrowDown") ? 1 : 0);
    const keyRoll =
      (keys.has("KeyE") || this.#rollRight ? 1 : 0) - (keys.has("KeyQ") || this.#rollLeft ? 1 : 0);
    const vr = this.#vr;
    const stickTurn = this.#flyStick(delta);
    this.#turn(
      keyYaw * KEY_TURN_RATE * delta +
        (vr ? vr.input.turn * VR_TURN_RATE * delta : 0) +
        stickTurn.yaw * delta,
      keyPitch * KEY_TURN_RATE * delta + stickTurn.pitch * delta,
      keyRoll * ROLL_RATE * delta,
    );

    // In VR, thrust goes where you look rather than where the ship's nose points.
    const heading = vr
      ? this.#heading.multiplyQuaternions(this.#orientation, vr.gaze)
      : this.#orientation;
    const forward = this.#forward.set(0, 0, -1).applyQuaternion(heading);
    const right = this.#right.copy(X_AXIS).applyQuaternion(heading);
    const holding = this.#touches.size > 0;
    const ahead = MathUtils.clamp(
      (keys.has("KeyW") || holding ? 1 : 0) - (keys.has("KeyS") ? 1 : 0) + (vr?.input.thrust ?? 0),
      -1,
      1,
    );
    const side = MathUtils.clamp(
      (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0) + (vr?.input.strafe ?? 0),
      -1,
      1,
    );
    const boosting =
      holding || keys.has("ShiftLeft") || keys.has("ShiftRight") || (vr?.input.boost ?? false);

    const thrust = this.#thrust.copy(forward).multiplyScalar(ahead).addScaledVector(right, side);
    if (thrust.lengthSq() > 1) thrust.normalize();
    this.#nearestGap = this.#gapAt(this.#camera.position);
    // How directly the ship is heading away from the nearest body (0–1): by where it's
    // thrusting, or where it's coasting when it isn't.
    const outward = this.#outward.subVectors(this.#camera.position, this.#nearestCentre);
    const going = thrust.lengthSq() > 0 ? thrust : this.#velocity;
    const leaving =
      going.lengthSq() > 0 && outward.lengthSq() > 0
        ? Math.max(0, going.dot(outward) / Math.sqrt(going.lengthSq() * outward.lengthSq()))
        : 0;
    const scale = Math.min(
      speedScale(this.#nearestGap, this.#nearestRadius) * (1 + (LEAVE_SPEEDUP - 1) * leaving),
      MAX_SPEED_SCALE,
    );
    const openSpace = MathUtils.smoothstep(
      this.#nearestGap / this.#nearestRadius,
      OPEN_SPACE_FROM,
      OPEN_SPACE_TO,
    );
    const drag =
      DRAG *
      (1 + (LEAVE_RESPONSE - 1) * leaving) *
      MathUtils.lerp(1, OPEN_SPACE_RESPONSE, openSpace);
    const topSpeed = (boosting ? BOOST_SPEED : CRUISE_SPEED) * scale;
    // Thrust balances drag exactly at top speed: a = v·drag.
    thrust.multiplyScalar(topSpeed * drag);

    // Thrust against drag: speed settles at a top speed instead of growing forever.
    const velocity = this.#velocity.addScaledVector(thrust, delta);
    velocity.multiplyScalar(Math.exp(-drag * delta));
    // Approaching a body lowers the limit; shed the excess quickly but smoothly.
    const limit = BOOST_SPEED * scale;
    const speed = velocity.length();
    if (speed > limit) {
      velocity.multiplyScalar(Math.max(limit / speed, Math.exp(-OVERSPEED_DRAG * delta)));
    }

    const from = this.#from.copy(this.#camera.position);
    const position = this.#camera.position.addScaledVector(velocity, delta);
    this.#keepClear(from, position);

    this.#camera.quaternion.copy(this.#orientation);
  }

  /** Distance from `point` to the nearest body's surface (and note that body's size and place). */
  #gapAt(point: Vector3): number {
    let gap = Infinity;
    for (const { radius, getPosition } of this.#obstacles()) {
      const distance = getPosition(this.#scratch).distanceTo(point) - radius;
      if (distance < gap) {
        gap = distance;
        this.#nearestRadius = radius;
        this.#nearestCentre.copy(this.#scratch);
      }
    }
    return Math.max(0, gap);
  }

  /** Push the mouse's flight stick by a mouse movement (pixels; y up). */
  #deflectStick(dx: number, dy: number): void {
    const stick = this.#stick;
    stick.x += dx * STICK_PER_PIXEL;
    stick.y += dy * STICK_PER_PIXEL;
    const length = Math.hypot(stick.x, stick.y);
    if (length > 1) {
      stick.x /= length;
      stick.y /= length;
    }
  }

  #centreStick(): void {
    this.#stick.x = this.#stick.y = 0;
    this.#stickTurn.yaw = this.#stickTurn.pitch = 0;
  }

  /** This frame's turn rate from the mouse's flight stick, which then drifts back to centre. */
  #flyStick(delta: number): { yaw: number; pitch: number } {
    const stick = this.#stick;
    const turn = this.#stickTurn;
    const ease = 1 - Math.exp(-STICK_RESPONSE * delta);
    turn.yaw += (stick.x * STICK_TURN_RATE - turn.yaw) * ease;
    turn.pitch += (stick.y * STICK_TURN_RATE - turn.pitch) * ease;
    const recenter = Math.exp(-STICK_RECENTER * delta);
    stick.x *= recenter;
    stick.y *= recenter;
    // Settle exactly, rather than turning imperceptibly forever.
    if (Math.hypot(stick.x, stick.y, turn.yaw, turn.pitch) < 1e-4) this.#centreStick();
    return turn;
  }

  /** Straight ahead (cameras look down their local −z). */
  #direction(): Vector3 {
    return this.#forward.set(0, 0, -1).applyQuaternion(this.#orientation);
  }

  /**
   * Turn about the ship's own axes. Positive yaw turns right, positive pitch raises the nose
   * and positive roll banks right (right wing down).
   */
  #turn(yaw: number, pitch: number, roll = 0): void {
    const orientation = this.#orientation;
    const step = this.#step;
    if (yaw) orientation.multiply(step.setFromAxisAngle(Y_AXIS, -yaw));
    if (pitch) orientation.multiply(step.setFromAxisAngle(X_AXIS, pitch));
    if (roll) orientation.multiply(step.setFromAxisAngle(Z_AXIS, -roll));
    // Many small rotations drift from unit length; keep it a pure rotation.
    orientation.normalize();
    // While following the phone, fold the turn into the reference so it sticks.
    if (this.#device) this.#rebase();
  }

  /** Make `reference × device` equal the current orientation. */
  #rebase(): void {
    this.#reference.copy(this.#orientation).multiply(this.#inverse.copy(this.#device!).invert());
  }

  /**
   * Slide along bodies instead of flying into them, and stay near the solar system.
   *
   * The whole path since the last frame is tested, not just where it ends: at boost speed one
   * frame can cover more than the Moon's diameter, which would otherwise pass straight through.
   */
  #keepClear(from: Vector3, position: Vector3): void {
    const move = this.#move;
    for (const { radius, getPosition } of this.#obstacles()) {
      const centre = getPosition(this.#scratch);
      const minimum = radius + surfaceClearance(radius);

      // Stop where the path first touches the clearance sphere; dropping the inward velocity
      // below then lets the ship slide along it.
      const hit = sweepSphere(from, position, centre, minimum);
      if (hit !== null) position.lerpVectors(from, move.copy(position), hit);

      // Also covers the body moving into a stationary ship (orbits keep going).
      const away = centre.subVectors(position, centre);
      const distance = away.length();
      // A hair of tolerance, so a ship resting on the surface still loses its inward velocity.
      if (distance > minimum + 1e-4 || distance === 0) continue;
      away.divideScalar(distance);
      position.addScaledVector(away, Math.max(0, minimum - distance));
      // Drop the part of the velocity heading into the body.
      const into = this.#velocity.dot(away);
      if (into < 0) this.#velocity.addScaledVector(away, -into);
    }
    if (position.length() > MAX_RANGE) {
      position.setLength(MAX_RANGE);
      const outward = this.#velocity.dot(this.#scratch.copy(position).normalize());
      if (outward > 0) this.#velocity.addScaledVector(this.#scratch, -outward);
    }
  }

  #lockPointer(): void {
    // Not every browser supports it (or allows it without a fresh click); dragging still works.
    try {
      const result: unknown = this.#canvas.requestPointerLock();
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      /* fall back to dragging */
    }
  }

  #bind(): void {
    this.#abort = new AbortController();
    const { signal } = this.#abort;
    const canvas = this.#canvas;

    window.addEventListener(
      "keydown",
      (event) => {
        if (!FLIGHT_KEYS.has(event.code) || event.ctrlKey || event.metaKey || event.altKey) return;
        this.#keys.add(event.code);
        if (event.code.startsWith("Arrow")) event.preventDefault();
      },
      { signal },
    );
    window.addEventListener("keyup", (event) => this.#keys.delete(event.code), { signal });
    // Releasing keys in another window must not leave the ship thrusting.
    window.addEventListener("blur", () => this.#keys.clear(), { signal });

    document.addEventListener(
      "mousemove",
      (event) => {
        if (this.#vr || document.pointerLockElement !== canvas) return;
        this.#deflectStick(event.movementX, -event.movementY);
      },
      { signal },
    );

    canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (event.pointerType === "mouse" && document.pointerLockElement !== canvas) {
          this.#lockPointer();
        }
        if (event.pointerType !== "mouse") {
          // Hold the screen to boost; keep tracking the finger even if it wanders off.
          canvas.setPointerCapture(event.pointerId);
          this.#touches.add(event.pointerId);
        }
        if (this.#drag || document.pointerLockElement === canvas) return;
        canvas.setPointerCapture(event.pointerId);
        this.#drag = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          sensitivity: event.pointerType === "mouse" ? MOUSE_SENSITIVITY : TOUCH_SENSITIVITY,
          steering: event.pointerType === "mouse",
        };
      },
      { signal },
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        const drag = this.#drag;
        if (!drag || drag.id !== event.pointerId) return;
        if (!drag.steering) {
          // Ignore the small wobble of a finger held still to boost.
          if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD) return;
          // Steer from here on, so the view doesn't jump by the threshold distance.
          drag.steering = true;
          drag.x = event.clientX;
          drag.y = event.clientY;
          return;
        }
        // Drag the view like grabbing the sky: moving right turns left, down looks up.
        this.#turn(
          -(event.clientX - drag.x) * drag.sensitivity,
          (event.clientY - drag.y) * drag.sensitivity,
        );
        drag.x = event.clientX;
        drag.y = event.clientY;
      },
      { signal },
    );
    const endDrag = (event: PointerEvent) => {
      this.#touches.delete(event.pointerId);
      if (this.#drag?.id === event.pointerId) this.#drag = null;
    };
    canvas.addEventListener("pointerup", endDrag, { signal });
    canvas.addEventListener("pointercancel", endDrag, { signal });
    canvas.addEventListener("lostpointercapture", endDrag, { signal });

    window.addEventListener("deviceorientation", (event) => this.#onDeviceOrientation(event), {
      signal,
    });

    // Going fullscreen can use up the click that started the flight, so the first attempt
    // at capturing the mouse may have failed; try again once fullscreen is in place.
    document.addEventListener(
      "fullscreenchange",
      () => {
        if (this.#wantsLock && !this.#vr && document.fullscreenElement) {
          if (document.pointerLockElement !== canvas) this.#lockPointer();
        }
      },
      { signal },
    );
  }

  /** Point the phone to look around: the view turns exactly as the phone does. */
  #onDeviceOrientation({ alpha, beta, gamma }: DeviceOrientationEvent): void {
    if (this.#vr || alpha === null || beta === null || gamma === null) return;
    const screenAngle = screen.orientation?.angle ?? 0;
    const target = deviceQuaternion(alpha, beta, gamma, screenAngle, this.#deviceTarget);
    if (!this.#device) {
      // Start from wherever the ship was facing, however the phone happens to be held.
      this.#device = target.clone();
      this.#rebase();
    }
    // The view itself follows in `#followDevice`, smoothed, once per frame.
  }

  /** Ease the view towards where the phone points, filtering out hand shake. */
  #followDevice(delta: number): void {
    const device = this.#device;
    if (!device) return;
    const gap = device.angleTo(this.#deviceTarget);
    const rate = MathUtils.lerp(SMOOTH_SLOW, SMOOTH_FAST, Math.min(gap / SMOOTH_ANGLE, 1));
    device.slerp(this.#deviceTarget, 1 - Math.exp(-rate * delta));
    this.#orientation.multiplyQuaternions(this.#reference, device);
  }
}
