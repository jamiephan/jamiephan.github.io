uniform float uTime;
uniform float uShift;
uniform float uHalfLength;
varying vec3 vNormal;
varying vec3 vTint;

// Rotation about a unit axis (Rodrigues).
mat3 rotation(vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  vec3 a = axis * (1.0 - c);
  return mat3(
    a.x * axis.x + c, a.y * axis.x + s * axis.z, a.z * axis.x - s * axis.y,
    a.x * axis.y - s * axis.z, a.y * axis.y + c, a.z * axis.y + s * axis.x,
    a.x * axis.z + s * axis.y, a.y * axis.z - s * axis.x, a.z * axis.z + c);
}

void main() {
  // Each rock tumbles about its own axis at its own rate, seeded by where it sits.
  vec3 seed = fract(instanceMatrix[3].xyz * vec3(0.1031, 0.1137, 0.0973));
  seed += dot(seed, seed.yzx + 33.33);
  seed = fract((seed.xxy + seed.yzz) * seed.zyx);
  vec3 axis = normalize(seed - 0.5 + 1e-3);
  float rate = mix(0.05, 0.7, seed.x) * (seed.y > 0.5 ? 1.0 : -1.0);
  mat3 spin = rotation(axis, uTime * rate);

  // Drift along the band, wrapping round; shrink to nothing near the ends.
  mat4 instance = instanceMatrix;
  float along = mod(instance[3].x + uShift + uHalfLength, 2.0 * uHalfLength) - uHalfLength;
  instance[3].x = along;
  float fade = 1.0 - smoothstep(0.7 * uHalfLength, uHalfLength, abs(along));

  mat4 model = modelMatrix * instance;
  vNormal = normalize(mat3(model) * (spin * normal));
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #else
    vTint = vec3(0.4);
  #endif
  gl_Position = projectionMatrix * viewMatrix * model * vec4(spin * position * fade, 1.0);
}
