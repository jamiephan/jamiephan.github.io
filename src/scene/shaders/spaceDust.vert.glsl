attribute vec2 aRandom; // size, brightness — 0..1
uniform float uPointScale;
uniform float uSize;
uniform vec3 uVelocity;
uniform vec2 uStreakSpeeds;
varying vec3 vColor;

void main() {
  vec3 offset = dustOffset(position);
  vec4 view = viewMatrix * vec4(uCameraPos + offset, 1.0);
  gl_Position = projectionMatrix * view;

  // Keep total light constant when a grain is smaller than a pixel, so they don't sparkle.
  float pixels = uSize * mix(0.5, 1.5, aRandom.x) * uPointScale / max(-view.z, 1e-3);
  gl_PointSize = clamp(pixels, 1.0, 3.0);
  float coverage = min(1.0, (pixels * pixels) / (gl_PointSize * gl_PointSize));
  // At speed the light is smeared into a streak instead (see the streak material).
  float streaking = smoothstep(uStreakSpeeds.x, uStreakSpeeds.y, length(uVelocity));

  vColor = dustLight(offset) * coverage * mix(0.3, 1.0, aRandom.y) * (1.0 - 0.7 * streaking);
}
