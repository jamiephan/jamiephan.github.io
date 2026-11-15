import { describe, expect, it } from "vite-plus/test";
import { deadZone, readVRInput, type ControllerLike } from "./xr.ts";

const controller = (
  handedness: string,
  axes: number[],
  pressed: boolean[] = [false, false],
): ControllerLike => ({
  handedness,
  gamepad: { axes, buttons: pressed.map((p) => ({ pressed: p })) },
});

describe("deadZone", () => {
  it("ignores small stick drift", () => {
    expect(deadZone(0.1)).toBe(0);
    expect(deadZone(-0.15)).toBe(0);
  });

  it("rescales the rest so full deflection is still 1", () => {
    expect(deadZone(1)).toBe(1);
    expect(deadZone(-1)).toBe(-1);
    expect(deadZone(0.575)).toBeCloseTo(0.5);
  });
});

describe("readVRInput", () => {
  it("is idle with no controllers", () => {
    expect(readVRInput([])).toEqual({ thrust: 0, strafe: 0, turn: 0, boost: false });
  });

  it("thrusts and strafes with the left stick, turns with the right", () => {
    const input = readVRInput([
      controller("left", [0, 0, 1, -1]),
      controller("right", [0, 0, -1, 0]),
    ]);
    expect(input).toEqual({ thrust: 1, strafe: 1, turn: -1, boost: false });
  });

  it("reads two-axis controllers from axes 0 and 1", () => {
    expect(readVRInput([controller("left", [0, -1])]).thrust).toBe(1);
  });

  it("boosts with the trigger or grip on either hand", () => {
    expect(readVRInput([controller("right", [0, 0, 0, 0], [true, false])]).boost).toBe(true);
    expect(readVRInput([controller("left", [0, 0, 0, 0], [false, true])]).boost).toBe(true);
  });

  it("skips sources without a gamepad, like hands or gaze", () => {
    expect(readVRInput([{ handedness: "none", gamepad: null }]).boost).toBe(false);
  });
});
