attribute vec4 aShape;   // centre, radius
attribute vec3 aColor;
attribute vec4 aMotion;  // rotation, spin, tile, flash delay
attribute vec2 aFlash;   // period, phase
attribute vec3 aFlashColor;
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;

// A short burst of two or three soft flickers, then darkness until the next one.
float lightning(float t) {
  if (t < 0.0 || t > 1.4) return 0.0;
  return exp(-t * 3.5) * (0.55 + 0.45 * cos(t * 13.0)) + 0.6 * exp(-pow((t - 0.55) * 9.0, 2.0));
}

void main() {
  vec4 view = modelViewMatrix * vec4(aShape.xyz, 1.0);
  float radius = aShape.w;

  // Fade as the camera gets close, so it drifts into the haze rather than through a card.
  float distance = length(view.xyz);
  float fade = smoothstep(0.12 * radius, 0.9 * radius, distance);

  // Slow churning: each puff turns and breathes a little.
  float angle = aMotion.x + aMotion.y * uTime;
  float breathe = 1.0 + 0.08 * sin(uTime * 0.3 + aMotion.x * 5.0);
  vec2 corner = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * position.xy;
  // Collapse fully faded puffs so they cost no fill rate.
  view.xy += corner * radius * breathe * step(0.001, fade);
  gl_Position = projectionMatrix * view;

  vec2 tile = vec2(mod(aMotion.z, 2.0), floor(aMotion.z / 2.0));
  vUv = (position.xy * 0.5 + 0.5 + tile) * 0.5;

  float cycle = mod(uTime / aFlash.x + aFlash.y, 1.0) * aFlash.x;
  float flash = lightning(cycle - aMotion.w);
  vColor = (aColor + aFlashColor * length(aColor) * flash * 1.6) * fade;
}
