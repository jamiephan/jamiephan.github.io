import { describe, expect, it } from "vite-plus/test";
import { KM_PER_UNIT, formatScientific, toRealSpeed } from "./units.ts";

describe("toRealSpeed", () => {
  it("uses the Earth's radius (4 units) as the ruler", () => {
    expect(toRealSpeed(4).kmPerSecond).toBeCloseTo(6371);
    expect(KM_PER_UNIT).toBeCloseTo(1592.75);
  });

  it("converts the speed of light to about 0.000114 light-years per hour", () => {
    const c = toRealSpeed(299_792.458 / KM_PER_UNIT);
    expect(c.ofLight).toBeCloseTo(1);
    expect(c.lightYearsPerHour).toBeCloseTo(1 / (365.25 * 24), 9);
  });

  it("is zero at rest", () => {
    expect(toRealSpeed(0)).toEqual({ kmPerSecond: 0, lightYearsPerHour: 0, ofLight: 0 });
  });
});

describe("formatScientific", () => {
  it("writes powers of ten with superscripts", () => {
    expect(formatScientific(0.0000121)).toBe("1.21 × 10⁻⁵");
    expect(formatScientific(12345)).toBe("1.23 × 10⁴");
    expect(formatScientific(3.14159)).toBe("3.14");
  });

  it("writes zero plainly", () => {
    expect(formatScientific(0)).toBe("0");
  });
});
