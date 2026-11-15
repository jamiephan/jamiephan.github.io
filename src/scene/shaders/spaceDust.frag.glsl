varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float falloff = exp(-dot(c, c) * 16.0);
  if (falloff < 0.02) discard;
  gl_FragColor = vec4(vColor * falloff, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
