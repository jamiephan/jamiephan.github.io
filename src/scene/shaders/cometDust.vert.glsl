attribute vec4 aRandom; // phase, β, size, brightness — all 0..1
attribute vec3 aDirection; // unit ejection direction
uniform vec3 uOrbitP;
uniform vec3 uOrbitQ;
uniform float uSemiMajorAxis;
uniform float uEccentricity;
uniform float uMeanAnomaly;
uniform float uMeanMotion;
uniform float uTime;
uniform float uActivity;
uniform vec3 uAxis;
uniform float uPointScale;
uniform float uLifetime;
uniform float uPressure;
uniform float uSpread;
uniform float uSize;
uniform float uOrbitLag;
uniform vec3 uHead;
varying float vBrightness;

void main() {
  float age = fract(aRandom.x + uTime / uLifetime) * uLifetime;
  float life = age / uLifetime;

  // Where the nucleus was when this grain left it (Kepler's equation, Newton's method).
  float e = uEccentricity;
  float M = uMeanAnomaly - uMeanMotion * age;
  float E = M + e * sin(M);
  for (int i = 0; i < 5; i++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
  float b = uSemiMajorAxis * sqrt(1.0 - e * e);
  vec3 released = uOrbitP * (uSemiMajorAxis * (cos(E) - e)) + uOrbitQ * (b * sin(E));

  // Radiation pressure (stronger on small grains) plus a slow random spread.
  float beta = mix(0.2, 1.0, aRandom.y);
  vec3 position = uHead + (released - uHead) * uOrbitLag
    + uAxis * (0.5 * uPressure * uActivity * beta * age * age)
    + aDirection * (uSpread * age);

  vec4 view = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;

  // Grains spread out (bigger, fainter) as they age; keep total light constant when the
  // point would be smaller than a pixel so distant tails don't sparkle.
  float worldSize = uSize * mix(0.6, 1.4, aRandom.z) * (1.0 + 1.5 * life);
  float pixels = worldSize * uPointScale / max(-view.z, 1e-3);
  gl_PointSize = clamp(pixels, 1.5, 48.0);
  float coverage = min(1.0, (pixels * pixels) / (gl_PointSize * gl_PointSize));

  vBrightness = pow(1.0 - life, 1.4) * smoothstep(0.0, 0.04, life)
    * mix(0.4, 1.0, aRandom.w) * uActivity * coverage;
}
