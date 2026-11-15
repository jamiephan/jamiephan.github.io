varying vec3 vLocalDir;
varying vec3 vWorldDir;
void main() {
  vLocalDir = position;
  vWorldDir = mat3(modelMatrix) * position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
