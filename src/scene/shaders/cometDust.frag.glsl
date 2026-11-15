uniform vec3 uColor;
uniform float uIntensity;
varying float vBrightness;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float falloff = exp(-dot(c, c) * 14.0);
  gl_FragColor = vec4(uColor * uIntensity * vBrightness * falloff, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
