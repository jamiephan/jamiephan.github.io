import { MathUtils, Quaternion, Vector3, type PerspectiveCamera } from "three";

/**
 * A very simple free-flight camera: point the nose with the mouse (or by tilting a phone),
 * thrust with W / S, strafe with A / D, roll with Q / E, and boost with Shift (or hold the
 * on-screen Boost button).
 *
 * Steering is relative to the ship, like a cockpit: after rolling, "up" on the mouse still
 * pitches towards the top of the screen. There's no up or down in space, so no limits.
 */

/** Units per second² of thrust, and how quickly speed bleeds off (per second). */
/** How quickly speed bleeds off when not thrusting (per second). */
const DRAG = 0.8;
/** Top speeds in units per second (the Earth is 8 units across). */
const CRUISE_SPEED = 20;
const BOOST_SPEED = 65;
/** Radians of turn per pixel of mouse movement or drag. */
const MOUSE_SENSITIVITY = 0.0025;
const TOUCH_SENSITIVITY = 0.005;
/** Arrow keys turn, and Q / E roll, at these rates (radians per second). */
const KEY_TURN_RATE = 1.2;
const ROLL_RATE = 1.6;
/** Tilt: degrees ignored around the starting pose, degrees for full turn rate, and that rate. */
const TILT_DEADZONE = 4;
const TILT_FULL = 30;
const TILT_TURN_RATE = 1.4;
/** Stay within this distance of the Earth, so the solar system can't be lost. */
const MAX_RANGE = 1000;
/**
 * Keep this far above a body's surface: a fraction of its radius, but never less than a fixed
 * gap, so the camera's near plane (0.5) can't slice into small bodies like the Moon.
 */
const CLEARANCE = 0.15;
const MIN_GAP = 1;

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
  /** The ship's orientation (the camera's), turned about its own axes. */
  readonly #orientation = new Quaternion();
  readonly #step = new Quaternion();

  #active = false;
  #abort: AbortController | null = null;
  /** On-screen buttons (touch). */
  #boost = false;
  #rollLeft = false;
  #rollRight = false;
  /** Device tilt relative to the pose when flight started (degrees). */
  #tiltBase: { beta: number; gamma: number } | null = null;
  #tilt = { pitch: 0, yaw: 0 };
  /** A finger or mouse button dragging to steer (when the pointer isn't locked). */
  #drag: { id: number; x: number; y: number; sensitivity: number } | null = null;

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

  /** Take over the camera from where it is now, facing the same way. */
  start(): void {
    if (this.#active) return;
    this.#active = true;
    this.#orientation.copy(this.#camera.quaternion);
    this.#velocity.set(0, 0, 0);
    this.#tiltBase = null;
    this.#tilt = { pitch: 0, yaw: 0 };
    this.#bind();
    // Capture the mouse straight away where allowed (this runs from the "Start" click).
    if (matchMedia("(pointer: fine)").matches) this.#lockPointer();
  }

  stop(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#abort?.abort();
    this.#abort = null;
    this.#keys.clear();
    this.#boost = false;
    this.#rollLeft = false;
    this.#rollRight = false;
    this.#drag = null;
    if (document.pointerLockElement === this.#canvas) document.exitPointerLock();
  }

  setBoost(on: boolean): void {
    this.#boost = on;
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

    // Steering: arrow keys and tilt turn at a rate; mouse and drag turn directly (see events).
    const keyYaw = (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
    const keyPitch = (keys.has("ArrowUp") ? 1 : 0) - (keys.has("ArrowDown") ? 1 : 0);
    const keyRoll =
      (keys.has("KeyE") || this.#rollRight ? 1 : 0) - (keys.has("KeyQ") || this.#rollLeft ? 1 : 0);
    this.#turn(
      (keyYaw * KEY_TURN_RATE + this.#tilt.yaw * TILT_TURN_RATE) * delta,
      (keyPitch * KEY_TURN_RATE + this.#tilt.pitch * TILT_TURN_RATE) * delta,
      keyRoll * ROLL_RATE * delta,
    );

    const forward = this.#direction();
    const right = this.#right.copy(X_AXIS).applyQuaternion(this.#orientation);
    const ahead = (keys.has("KeyW") || this.#boost ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const side = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const boosting = this.#boost || keys.has("ShiftLeft") || keys.has("ShiftRight");

    const thrust = this.#thrust.copy(forward).multiplyScalar(ahead).addScaledVector(right, side);
    if (thrust.lengthSq() > 1) thrust.normalize();
    // Thrust balances drag exactly at top speed: a = v·drag.
    thrust.multiplyScalar((boosting ? BOOST_SPEED : CRUISE_SPEED) * DRAG);

    // Thrust against drag: speed settles at a top speed instead of growing forever.
    const velocity = this.#velocity.addScaledVector(thrust, delta);
    velocity.multiplyScalar(Math.exp(-DRAG * delta));

    const from = this.#from.copy(this.#camera.position);
    const position = this.#camera.position.addScaledVector(velocity, delta);
    this.#keepClear(from, position);

    this.#camera.quaternion.copy(this.#orientation);
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
      const minimum = radius + Math.max(radius * CLEARANCE, MIN_GAP);

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
        if (document.pointerLockElement !== canvas) return;
        this.#turn(event.movementX * MOUSE_SENSITIVITY, -event.movementY * MOUSE_SENSITIVITY);
      },
      { signal },
    );

    canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (event.pointerType === "mouse" && document.pointerLockElement !== canvas) {
          this.#lockPointer();
        }
        if (this.#drag || document.pointerLockElement === canvas) return;
        canvas.setPointerCapture(event.pointerId);
        this.#drag = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          sensitivity: event.pointerType === "mouse" ? MOUSE_SENSITIVITY : TOUCH_SENSITIVITY,
        };
      },
      { signal },
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        const drag = this.#drag;
        if (!drag || drag.id !== event.pointerId) return;
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
      if (this.#drag?.id === event.pointerId) this.#drag = null;
    };
    canvas.addEventListener("pointerup", endDrag, { signal });
    canvas.addEventListener("pointercancel", endDrag, { signal });

    window.addEventListener("deviceorientation", (event) => this.#onTilt(event), { signal });
  }

  /** Steer by tilting: lean the phone away from how it was held when flight started. */
  #onTilt({ beta, gamma }: DeviceOrientationEvent): void {
    if (beta === null || gamma === null) return;
    this.#tiltBase ??= { beta, gamma };
    const forwardBack = beta - this.#tiltBase.beta;
    const leftRight = gamma - this.#tiltBase.gamma;

    // beta / gamma are relative to the device, so swap them round in landscape.
    const angle = screen.orientation?.angle ?? 0;
    const [pitchTilt, yawTilt] =
      angle === 90
        ? [leftRight, forwardBack]
        : angle === 270 || angle === -90
          ? [-leftRight, -forwardBack]
          : [forwardBack, leftRight];

    const rate = (degrees: number) =>
      Math.sign(degrees) *
      MathUtils.clamp((Math.abs(degrees) - TILT_DEADZONE) / (TILT_FULL - TILT_DEADZONE), 0, 1);
    // Like a yoke: tip the top away to dive, lower the right side to turn right.
    this.#tilt = { pitch: rate(pitchTilt), yaw: rate(yawTilt) };
  }
}
