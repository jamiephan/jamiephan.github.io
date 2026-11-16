varying vec3 vLocalDir;
varying vec3 vWorldDir;
void main() {
  vLocalDir = position;
  vWorldDir = mat3(modelMatrix) * position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // On the far plane: the sky is drawn after the bodies, and only where none of them is.
  gl_Position.z = gl_Position.w;
}
