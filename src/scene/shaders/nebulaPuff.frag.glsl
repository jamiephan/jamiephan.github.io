uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float density = texture2D(uAtlas, vUv).r;
  if (density < 0.004) discard;
  gl_FragColor = vec4(vColor * density, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
