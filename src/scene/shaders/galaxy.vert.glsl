varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // On the far plane, like the sky: only drawn where nothing in the scene is.
  gl_Position.z = gl_Position.w;
}
