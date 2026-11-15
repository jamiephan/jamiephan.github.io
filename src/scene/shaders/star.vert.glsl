attribute vec3 aColor;
attribute float aSize;
uniform float uPixelRatio;
uniform vec3 uSunDir;
varying vec3 vColor;

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Stars vanish in the Sun's glare.
  float sunAngle = dot(normalize(mat3(modelMatrix) * position), uSunDir);
  vColor = aColor * (1.0 - smoothstep(0.85, 0.99, sunAngle));
  gl_PointSize = aSize * uPixelRatio;
}
