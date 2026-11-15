/**
 * Kepler orbits in their own plane, with the focus (the body being orbited) at the origin.
 * The x axis points to periapsis; motion is anticlockwise (towards +y).
 */

export interface OrbitState {
  /** Position in the orbital plane. */
  x: number;
  y: number;
  /** Direction of travel (not normalised). */
  vx: number;
  vy: number;
  /** Distance from the focus. */
  r: number;
}

/** Solve Kepler's equation `E - e·sin(E) = M` for the eccentric anomaly E (Newton's method). */
export const eccentricAnomaly = (meanAnomaly: number, eccentricity: number): number => {
  // Danby's starting guess converges for every eccentricity below 1.
  let E = meanAnomaly + 0.85 * eccentricity * Math.sign(Math.sin(meanAnomaly));
  for (let i = 0; i < 30; i++) {
    const step = (E - eccentricity * Math.sin(E) - meanAnomaly) / (1 - eccentricity * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return E;
};

/**
 * Position and direction of travel on an ellipse with semi-major axis `a` and eccentricity `e`,
 * `meanAnomaly` radians after periapsis. Mean anomaly grows linearly with time, so the body
 * speeds up near periapsis and slows down far away, as a real orbit does.
 */
export const orbitAt = (meanAnomaly: number, a: number, e: number): OrbitState => {
  const E = eccentricAnomaly(meanAnomaly, e);
  const b = a * Math.sqrt(1 - e * e);
  const x = a * (Math.cos(E) - e);
  const y = b * Math.sin(E);
  return { x, y, vx: -a * Math.sin(E), vy: b * Math.cos(E), r: Math.hypot(x, y) };
};

/** Mean anomaly (radians of "time" since periapsis) at a given true anomaly (actual angle). */
export const meanAnomalyAt = (trueAnomaly: number, eccentricity: number): number => {
  const E =
    2 *
    Math.atan2(
      Math.sqrt(1 - eccentricity) * Math.sin(trueAnomaly / 2),
      Math.sqrt(1 + eccentricity) * Math.cos(trueAnomaly / 2),
    );
  return E - eccentricity * Math.sin(E);
};

/**
 * Fraction of each orbit spent where `isVisible(x, y)` holds (x, y in the orbital plane).
 * Samples are evenly spaced in mean anomaly, which by Kepler's second law means evenly spaced
 * in time, so this is exactly the share of time the body is visible.
 */
export const visibleFraction = (
  isVisible: (x: number, y: number) => boolean,
  semiMajorAxis: number,
  eccentricity: number,
  samples = 720,
): number => {
  let visible = 0;
  for (let i = 0; i < samples; i++) {
    const { x, y } = orbitAt(((i + 0.5) / samples) * 2 * Math.PI, semiMajorAxis, eccentricity);
    if (isVisible(x, y)) visible++;
  }
  return visible / samples;
};

/** Orbital period that keeps a body out of view for `hiddenSeconds` per orbit. */
export const periodForHiddenTime = (hiddenSeconds: number, fractionVisible: number): number =>
  hiddenSeconds / (1 - Math.min(fractionVisible, 0.9));
