uniform vec3 uColor;
uniform float uActivity;
varying vec2 vOffset;
void main() {
  float r2 = dot(vOffset, vOffset);
  float glow = exp(-r2 * 6.0) * 0.6 * uActivity + exp(-r2 * 60.0) * (1.0 + 1.5 * uActivity);
  gl_FragColor = vec4(uColor * glow, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
