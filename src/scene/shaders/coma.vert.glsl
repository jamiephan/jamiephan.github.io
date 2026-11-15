uniform vec3 uHead;
uniform float uSize;
varying vec2 vOffset;
void main() {
  vOffset = position.xy;
  vec4 view = viewMatrix * vec4(uHead, 1.0);
  view.xy += position.xy * uSize;
  gl_Position = projectionMatrix * view;
}
