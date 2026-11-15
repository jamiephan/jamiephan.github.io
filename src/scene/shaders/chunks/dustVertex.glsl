// Shared by the dust dots and streaks: where a grain is, and how much sunlight it scatters.
uniform vec3 uCameraPos;
uniform float uTime;
uniform float uBoxSize;
uniform float uIntensity;
uniform vec3 uDrift;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec4 uEarth;

// Wrap a grain into the box centred on the camera; returns its offset from the camera.
vec3 dustOffset(vec3 unitPosition) {
  return mod(unitPosition * uBoxSize + uDrift * uTime - uCameraPos, uBoxSize) - 0.5 * uBoxSize;
}

// Sunlight scattered towards the camera, faded near the box edge (where grains wrap) and
// right in front of the lens.
vec3 dustLight(vec3 offset) {
  float dist = length(offset);
  float fade = (1.0 - smoothstep(0.3 * uBoxSize, 0.5 * uBoxSize, dist)) * smoothstep(0.6, 2.5, dist);
  // Henyey–Greenstein forward scattering (g = 0.6), plus a little back-scatter.
  float cosTheta = dot(offset / max(dist, 1e-3), uSunDir);
  float g = 0.6;
  float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5) + 0.3;
  float shadow = sphereShadow(uCameraPos + offset, uSunDir, uEarth);
  return uSunColor * vec3(1.0, 0.93, 0.85) * uIntensity * phase * shadow * fade;
}
