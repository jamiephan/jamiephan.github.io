varying vec3 vNormal;
varying vec3 vTint;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
void main() {
  float NdL = max(dot(normalize(vNormal), uSunDir), 0.0);
  vec3 color = vTint * (uSunColor * NdL + vec3(0.01, 0.012, 0.016));
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
