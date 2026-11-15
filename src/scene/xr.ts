/**
 * VR (WebXR) controller input for flight mode.
 *
 * Left thumbstick: thrust (push forward) and strafe, towards wherever you're looking.
 * Right thumbstick: turn left and right. Trigger or grip on either hand: boost.
 */

/** Whether this browser and device can show immersive VR (WebXR). */
export const isVRSupported = async (): Promise<boolean> => {
  try {
    return (await navigator.xr?.isSessionSupported("immersive-vr")) ?? false;
  } catch {
    // e.g. blocked by a permissions policy.
    return false;
  }
};

/** Analog flight input from VR controllers, each in −1…1. */
export interface VRInput {
  /** Forward (+) or back (−). */
  thrust: number;
  /** Right (+) or left (−). */
  strafe: number;
  /** Turn right (+) or left (−). */
  turn: number;
  boost: boolean;
}

/** The parts of an `XRInputSource` this reads, so it can be tested without a headset. */
export interface ControllerLike {
  handedness: string;
  gamepad?: {
    axes: readonly number[];
    buttons: readonly { pressed: boolean }[];
  } | null;
}

/** Thumbsticks rarely rest at exactly zero; ignore this much and rescale the rest. */
const DEAD_ZONE = 0.15;

export const deadZone = (value: number): number => {
  const size = Math.abs(value);
  if (size <= DEAD_ZONE) return 0;
  return (Math.sign(value) * (Math.min(size, 1) - DEAD_ZONE)) / (1 - DEAD_ZONE);
};

/**
 * The thumbstick's x and y. With the "xr-standard" mapping it's axes 2 and 3 (0 and 1 are a
 * touchpad, if any); controllers with only two axes put the stick there instead.
 */
const thumbstick = (axes: readonly number[]): [number, number] =>
  axes.length >= 4 ? [axes[2] ?? 0, axes[3] ?? 0] : [axes[0] ?? 0, axes[1] ?? 0];

export const readVRInput = (sources: Iterable<ControllerLike>): VRInput => {
  const input: VRInput = { thrust: 0, strafe: 0, turn: 0, boost: false };
  for (const { handedness, gamepad } of sources) {
    if (!gamepad) continue;
    const [x, y] = thumbstick(gamepad.axes);
    if (handedness === "left") {
      // Pushing a stick forward reports a negative y.
      input.thrust = deadZone(-y);
      input.strafe = deadZone(x);
    } else if (handedness === "right") {
      input.turn = deadZone(x);
    }
    // Button 0 is the trigger, 1 the grip.
    if (gamepad.buttons[0]?.pressed || gamepad.buttons[1]?.pressed) input.boost = true;
  }
  return input;
};
